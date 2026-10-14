import { describe, expect, it } from 'vitest';
import {
  buildPushPayload,
  resolveRecipients,
  shouldSuppress,
  truncatePreview,
  type MemberPrefs,
  type PresenceMap,
} from './notification';

const laura: MemberPrefs = {
  id: 'laura',
  role: 'AGENT',
  notifyAssigned: true,
  notifyCustomerMessage: true,
  notifySendFailed: true,
  notifyNewAiConversation: false,
};
const owner: MemberPrefs = {
  id: 'owner',
  role: 'OWNER',
  notifyAssigned: true,
  notifyCustomerMessage: true,
  notifySendFailed: true,
  notifyNewAiConversation: true,
};
const admin: MemberPrefs = {
  id: 'admin',
  role: 'ADMIN',
  notifyAssigned: true,
  notifyCustomerMessage: true,
  notifySendFailed: true,
  notifyNewAiConversation: false,
};

describe('truncatePreview', () => {
  it('deja el texto corto y recorta a 80 con puntos suspensivos', () => {
    expect(truncatePreview('  hola  ')).toBe('hola');
    expect(truncatePreview('a'.repeat(80))).toHaveLength(80);
    expect(truncatePreview('a'.repeat(81))).toBe(`${'a'.repeat(79)}…`);
  });
});

describe('buildPushPayload', () => {
  const contact = { displayName: 'Ana', externalId: '+573001112233' };

  it('usa el teléfono si el contacto no tiene nombre', () => {
    expect(
      buildPushPayload('assigned', { displayName: '  ', externalId: '+57' }, null, 'c1', 't1', '/omnidesk')
        .title,
    ).toBe('+57');
  });

  it('arma título, cuerpo y la ruta de la conversación', () => {
    expect(
      buildPushPayload('assigned', contact, null, 'c1', 't1', '/omnidesk'),
    ).toMatchObject({
      title: 'Ana',
      body: 'Te asignaron esta conversación',
      tag: 'c1',
      url: '/omnidesk/conversations/c1',
      tenantId: 't1',
    });
    expect(
      buildPushPayload('customer_message', contact, 'a'.repeat(90), 'c1', 't1', '/omnidesk').body,
    ).toHaveLength(80);
    expect(buildPushPayload('send_failed', contact, null, 'c1', 't1', '/omnidesk').body).toBe(
      'No se pudo enviar tu mensaje',
    );
  });
});

describe('resolveRecipients', () => {
  const members = [laura, owner, admin];

  it('avisa al agente asignado, salvo si se asignó él mismo o tiene el interruptor apagado', () => {
    expect(
      resolveRecipients('assigned', {
        actorMemberId: 'owner',
        assignedAgentId: 'laura',
        senderMemberId: null,
        members,
      }),
    ).toEqual(['laura']);
    expect(
      resolveRecipients('assigned', {
        actorMemberId: 'laura',
        assignedAgentId: 'laura',
        senderMemberId: null,
        members,
      }),
    ).toEqual([]);
    expect(
      resolveRecipients('assigned', {
        actorMemberId: 'owner',
        assignedAgentId: 'laura',
        senderMemberId: null,
        members: [{ ...laura, notifyAssigned: false }],
      }),
    ).toEqual([]);
  });

  it('el mensaje del cliente va al agente asignado si el interruptor está activo', () => {
    expect(
      resolveRecipients('customer_message', {
        actorMemberId: null,
        assignedAgentId: 'laura',
        senderMemberId: null,
        members,
      }),
    ).toEqual(['laura']);
    expect(
      resolveRecipients('customer_message', {
        actorMemberId: null,
        assignedAgentId: 'laura',
        senderMemberId: null,
        members: [{ ...laura, notifyCustomerMessage: false }],
      }),
    ).toEqual([]);
  });

  it('el fallo de envío va a quien escribió', () => {
    expect(
      resolveRecipients('send_failed', {
        actorMemberId: null,
        assignedAgentId: 'laura',
        senderMemberId: 'laura',
        members,
      }),
    ).toEqual(['laura']);
  });

  it('una conversación nueva en IA va a OWNER y ADMIN con el interruptor activo', () => {
    expect(
      resolveRecipients('new_ai_conversation', {
        actorMemberId: null,
        assignedAgentId: null,
        senderMemberId: null,
        members,
      }),
    ).toEqual(['owner']);
  });
});

describe('shouldSuppress', () => {
  const presence: PresenceMap = new Map([
    ['s1', { memberId: 'laura', conversationId: 'c1', visible: true }],
    ['s2', { memberId: 'laura', conversationId: 'c1', visible: false }],
  ]);

  it('calla el mensaje del cliente si algún socket lo está viendo', () => {
    expect(shouldSuppress('customer_message', 'laura', 'c1', presence)).toBe(true);
    expect(shouldSuppress('customer_message', 'laura', 'otra', presence)).toBe(false);
    expect(shouldSuppress('assigned', 'laura', 'c1', presence)).toBe(false);
  });

  it('con la pestaña oculta sí se notifica', () => {
    const hidden: PresenceMap = new Map([
      ['s2', { memberId: 'laura', conversationId: 'c1', visible: false }],
    ]);
    expect(shouldSuppress('customer_message', 'laura', 'c1', hidden)).toBe(false);
  });
});
