import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import { InMemoryChannels, plainCipher } from '../testing/in-memory';
import { GenerateN8nClientSecretUseCase, RemoveN8nClientUseCase } from './channels.use-cases';
import type { ChannelRepository } from './ports/channel.repository';

const clock = { now: () => new Date('2026-10-16T10:00:00.000Z') };
const actor = (role: ActorContext['role'], tenantId = 't1'): ActorContext => ({
  userId: 'u1',
  tenantId,
  memberId: 'm1',
  role,
});

describe('secreto de cliente de n8n (SPEC 22)', () => {
  let channels: InMemoryChannels;
  let generate: GenerateN8nClientSecretUseCase;
  let remove: RemoveN8nClientUseCase;
  const stored = () => plainCipher.decrypt(channels.byId.get('c1')!.n8nClientSecretEnc!);

  beforeEach(() => {
    channels = new InMemoryChannels();
    channels.add({ id: 'c1', tenantId: 't1', webhookUrl: 'https://n8n.example.com/w' });
    const repo = channels as unknown as ChannelRepository;
    generate = new GenerateN8nClientSecretUseCase(repo, plainCipher);
    remove = new RemoveN8nClientUseCase(repo, clock);
  });

  it('genera un secreto ncs_ y lo guarda cifrado; el clientId es el id del canal', async () => {
    const result = await generate.execute(actor('OWNER'), 'c1');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.credentials.clientId).toBe('c1');
    expect(result.credentials.clientSecret).toMatch(/^ncs_[A-Za-z0-9_-]{43}$/);
    expect(stored()).toBe(result.credentials.clientSecret);
  });

  it('regenerar sustituye el secreto anterior', async () => {
    const first = await generate.execute(actor('OWNER'), 'c1');
    const second = await generate.execute(actor('ADMIN'), 'c1');
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('esperaba ok');
    expect(second.credentials.clientSecret).not.toBe(first.credentials.clientSecret);
    expect(stored()).toBe(second.credentials.clientSecret);
  });

  it('un AGENT no puede generar ni quitar', async () => {
    expect((await generate.execute(actor('AGENT'), 'c1')).kind).toBe('forbidden');
    expect((await remove.execute(actor('AGENT'), 'c1')).kind).toBe('forbidden');
    expect(channels.byId.get('c1')!.n8nClientSecretEnc).toBeNull();
  });

  it('un canal de otra empresa no existe', async () => {
    expect((await generate.execute(actor('OWNER', 't2'), 'c1')).kind).toBe('not-found');
    expect((await remove.execute(actor('OWNER', 't2'), 'c1')).kind).toBe('not-found');
  });

  it('quitar el secreto apaga la IA y se puede repetir', async () => {
    await generate.execute(actor('OWNER'), 'c1');
    channels.byId.get('c1')!.aiEnabled = true;
    const result = await remove.execute(actor('OWNER'), 'c1');
    expect(result).toMatchObject({
      kind: 'ok',
      channel: { hasN8nClientSecret: false, aiEnabled: false },
    });
    expect((await remove.execute(actor('OWNER'), 'c1')).kind).toBe('ok');
  });
});
