import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  InMemoryContacts,
  InMemoryConversations,
  InMemoryMembers,
  InMemoryOutbox,
  noTransaction,
} from '../testing/in-memory';
import { AssignConversationUseCase } from './assign-conversation.use-case';
import { CloseConversationUseCase } from './close-conversation.use-case';
import { ConversationCommandRunner } from './conversation-command-runner';
import { RegisterInboundMessageUseCase } from './register-inbound-message.use-case';
import { ReleaseConversationUseCase } from './release-conversation.use-case';
import { ReopenConversationUseCase } from './reopen-conversation.use-case';

const integration = { tenantId: 't1', channelId: 'c1' };

const owner: ActorContext = { tenantId: 't1', memberId: 'owner', role: 'OWNER' };
const laura: ActorContext = { tenantId: 't1', memberId: 'laura', role: 'AGENT' };
const mateo: ActorContext = { tenantId: 't1', memberId: 'mateo', role: 'AGENT' };

describe('comandos de conversación', () => {
  let conversations: InMemoryConversations;
  let outbox: InMemoryOutbox;
  let assign: AssignConversationUseCase;
  let release: ReleaseConversationUseCase;
  let close: CloseConversationUseCase;
  let reopen: ReopenConversationUseCase;
  let conversationId: string;

  beforeEach(async () => {
    conversations = new InMemoryConversations();
    outbox = new InMemoryOutbox();
    const members = new InMemoryMembers();
    members.add({ id: 'owner', role: 'OWNER' });
    members.add({ id: 'laura', role: 'AGENT' });
    members.add({ id: 'mateo', role: 'AGENT' });
    members.add({ id: 'ajeno', role: 'AGENT', tenantId: 'otro-tenant' });

    const runner = new ConversationCommandRunner(noTransaction, conversations, members, outbox);
    assign = new AssignConversationUseCase(runner);
    release = new ReleaseConversationUseCase(runner);
    close = new CloseConversationUseCase(runner);
    reopen = new ReopenConversationUseCase(runner);

    const inbound = new RegisterInboundMessageUseCase(
      noTransaction,
      conversations,
      new InMemoryContacts(),
      new InMemoryOutbox(),
    );
    conversationId = (
      await inbound.execute(integration, {
        externalMessageId: 'm1',
        from: { externalId: '+573001234567' },
        text: 'Hola',
        sentAt: new Date(),
      })
    ).conversationId;
  });

  const conversation = () => conversations.conversations.find((c) => c.id === conversationId)!;
  const assignTo = (
    actor: ActorContext,
    memberId: string,
    controlVersion = conversation().controlVersion,
  ) => assign.execute(actor, { conversationId, memberId, controlVersion });
  const command = (
    useCase: ReleaseConversationUseCase | CloseConversationUseCase | ReopenConversationUseCase,
    actor: ActorContext,
    controlVersion = conversation().controlVersion,
  ) => useCase.execute(actor, { conversationId, controlVersion });

  describe('assign', () => {
    it('asigna, sube controlVersion en 1 y registra ASSIGNED con actor y destino', async () => {
      expect(await assignTo(owner, 'laura')).toEqual({ kind: 'ok' });

      expect(conversation()).toMatchObject({ assignedAgentId: 'laura', controlVersion: 1 });
      expect(conversations.events).toEqual([
        expect.objectContaining({
          type: 'ASSIGNED',
          actorMemberId: 'owner',
          targetMemberId: 'laura',
          sequence: 2,
        }),
      ]);
    });

    it('encola conversation.changed con reason assignment', async () => {
      await assignTo(owner, 'laura');

      expect(outbox.events).toEqual([
        expect.objectContaining({
          type: 'conversation.changed',
          payload: expect.objectContaining({ conversationId, reason: 'assignment' }),
        }),
      ]);
    });

    it('rechaza con CONTROL_CHANGED un controlVersion viejo y no cambia nada', async () => {
      await assignTo(owner, 'laura');

      expect(await assignTo(owner, 'mateo', 0)).toEqual({
        kind: 'rejected',
        reason: 'CONTROL_CHANGED',
      });
      expect(conversation()).toMatchObject({ assignedAgentId: 'laura', controlVersion: 1 });
      expect(conversations.events).toHaveLength(1);
      expect(outbox.events).toHaveLength(1);
    });

    it('un AGENT toma una conversación de la IA', async () => {
      expect(await assignTo(laura, 'laura')).toEqual({ kind: 'ok' });
      expect(conversation().assignedAgentId).toBe('laura');
    });

    it('un AGENT no puede asignar a otro (forbidden)', async () => {
      expect(await assignTo(laura, 'mateo')).toEqual({ kind: 'forbidden' });
      expect(conversation().controlVersion).toBe(0);
    });

    it('un AGENT no ve la conversación asignada a otro: not-found, no forbidden', async () => {
      await assignTo(owner, 'mateo');

      expect(await assignTo(laura, 'laura')).toEqual({ kind: 'not-found' });
    });

    it('responde member-not-found si el destino no es del tenant', async () => {
      expect(await assignTo(owner, 'ajeno')).toEqual({ kind: 'member-not-found' });
      expect(await assignTo(owner, 'fantasma')).toEqual({ kind: 'member-not-found' });
    });

    it('rechaza con INVALID_STATE asignar a quien ya la tiene o una cerrada', async () => {
      await assignTo(owner, 'laura');
      expect(await assignTo(owner, 'laura')).toEqual({ kind: 'rejected', reason: 'INVALID_STATE' });

      await command(close, owner);
      expect(await assignTo(owner, 'mateo')).toEqual({ kind: 'rejected', reason: 'INVALID_STATE' });
    });

    it('responde not-found para una conversación de otro tenant', async () => {
      expect(await assignTo({ ...owner, tenantId: 'otro-tenant' }, 'laura')).toEqual({
        kind: 'not-found',
      });
    });
  });

  describe('release', () => {
    it('devuelve la conversación a la IA y registra RELEASED', async () => {
      await assignTo(owner, 'laura');

      expect(await command(release, laura)).toEqual({ kind: 'ok' });

      expect(conversation()).toMatchObject({
        assignedAgentId: null,
        status: 'OPEN',
        controlVersion: 2,
      });
      expect(conversations.events.at(-1)).toMatchObject({
        type: 'RELEASED',
        actorMemberId: 'laura',
      });
    });

    it('un AGENT no libera la de otro (not-found) y un OWNER sí', async () => {
      await assignTo(owner, 'laura');

      expect(await command(release, mateo)).toEqual({ kind: 'not-found' });
      expect(await command(release, owner)).toEqual({ kind: 'ok' });
    });

    it('un AGENT no libera una que no es suya aunque la vea (forbidden)', async () => {
      expect(await command(release, laura)).toEqual({ kind: 'forbidden' });
    });

    it('rechaza con INVALID_STATE liberar una conversación sin agente', async () => {
      expect(await command(release, owner)).toEqual({ kind: 'rejected', reason: 'INVALID_STATE' });
    });
  });

  describe('close y reopen', () => {
    it('close deja CLOSED conservando el agente y reopen lo devuelve a la IA sin agente', async () => {
      await assignTo(owner, 'laura');

      expect(await command(close, laura)).toEqual({ kind: 'ok' });
      expect(conversation()).toMatchObject({ status: 'CLOSED', assignedAgentId: 'laura' });
      expect(conversations.events.at(-1)).toMatchObject({ type: 'CLOSED', actorMemberId: 'laura' });

      expect(await command(reopen, laura)).toEqual({ kind: 'ok' });
      expect(conversation()).toMatchObject({ status: 'OPEN', assignedAgentId: null });
      expect(conversations.events.at(-1)).toMatchObject({
        type: 'REOPENED',
        actorMemberId: 'laura',
      });
      expect(conversation().controlVersion).toBe(3);
    });

    it('close sobre una conversación ya cerrada responde INVALID_STATE', async () => {
      await command(close, owner);

      expect(await command(close, owner)).toEqual({ kind: 'rejected', reason: 'INVALID_STATE' });
    });

    it('reopen sobre una abierta responde INVALID_STATE', async () => {
      expect(await command(reopen, owner)).toEqual({ kind: 'rejected', reason: 'INVALID_STATE' });
    });

    it('un AGENT solo cierra y reabre las suyas', async () => {
      expect(await command(close, laura)).toEqual({ kind: 'forbidden' });
      await assignTo(owner, 'laura');
      await command(close, laura);
      expect(await command(reopen, mateo)).toEqual({ kind: 'not-found' });
    });

    it('cada comando consume una sequence del contador compartido con los mensajes', async () => {
      await assignTo(owner, 'laura');
      await command(close, owner);

      expect(conversations.events.map((e) => e.sequence)).toEqual([2, 3]);
    });
  });
});
