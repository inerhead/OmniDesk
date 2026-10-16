import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import { InMemoryChannels, plainCipher } from '../testing/in-memory';
import { ConfigureN8nClientUseCase, RemoveN8nClientUseCase } from './channels.use-cases';
import type { ChannelRepository } from './ports/channel.repository';

const clock = { now: () => new Date('2026-10-16T10:00:00.000Z') };
const actor = (role: ActorContext['role'], tenantId = 't1'): ActorContext => ({
  userId: 'u1',
  tenantId,
  memberId: 'm1',
  role,
});

describe('credenciales de cliente de n8n (SPEC 22)', () => {
  let channels: InMemoryChannels;
  let configure: ConfigureN8nClientUseCase;
  let remove: RemoveN8nClientUseCase;

  beforeEach(() => {
    channels = new InMemoryChannels();
    channels.add({ id: 'c1', tenantId: 't1', webhookUrl: 'https://n8n.example.com/w' });
    const repo = channels as unknown as ChannelRepository;
    configure = new ConfigureN8nClientUseCase(repo, plainCipher, clock);
    remove = new RemoveN8nClientUseCase(repo, clock);
  });

  it('guarda el clientId y el secreto cifrado', async () => {
    const result = await configure.execute(actor('OWNER'), 'c1', {
      clientId: 'acme',
      clientSecret: '0123456789abcdef',
    });
    expect(result).toMatchObject({
      kind: 'ok',
      channel: { n8nClientId: 'acme', hasN8nClientSecret: true },
    });
    expect(result.kind === 'ok' && 'n8nClientSecretEnc' in result.channel).toBe(false);
    expect(plainCipher.decrypt(channels.byId.get('c1')!.n8nClientSecretEnc!)).toBe(
      '0123456789abcdef',
    );
  });

  it('ADMIN también puede; AGENT no', async () => {
    const input = { clientId: 'acme', clientSecret: '0123456789abcdef' };
    expect((await configure.execute(actor('ADMIN'), 'c1', input)).kind).toBe('ok');
    expect((await configure.execute(actor('AGENT'), 'c1', input)).kind).toBe('forbidden');
    expect((await remove.execute(actor('AGENT'), 'c1')).kind).toBe('forbidden');
  });

  it('exige el secreto la primera vez', async () => {
    expect((await configure.execute(actor('OWNER'), 'c1', { clientId: 'acme' })).kind).toBe(
      'secret-required',
    );
    expect(channels.byId.get('c1')!.n8nClientId).toBeNull();
  });

  it('omitir el secreto conserva el guardado', async () => {
    await configure.execute(actor('OWNER'), 'c1', {
      clientId: 'acme',
      clientSecret: '0123456789abcdef',
    });
    const result = await configure.execute(actor('OWNER'), 'c1', { clientId: 'otro' });
    expect(result).toMatchObject({ kind: 'ok', channel: { n8nClientId: 'otro' } });
    expect(plainCipher.decrypt(channels.byId.get('c1')!.n8nClientSecretEnc!)).toBe(
      '0123456789abcdef',
    );
  });

  it('un canal de otra empresa no existe', async () => {
    const input = { clientId: 'acme', clientSecret: '0123456789abcdef' };
    expect((await configure.execute(actor('OWNER', 't2'), 'c1', input)).kind).toBe('not-found');
    expect((await remove.execute(actor('OWNER', 't2'), 'c1')).kind).toBe('not-found');
  });

  it('quitar las credenciales apaga la IA y se puede repetir', async () => {
    await configure.execute(actor('OWNER'), 'c1', {
      clientId: 'acme',
      clientSecret: '0123456789abcdef',
    });
    channels.byId.get('c1')!.aiEnabled = true;
    const result = await remove.execute(actor('OWNER'), 'c1');
    expect(result).toMatchObject({
      kind: 'ok',
      channel: { n8nClientId: null, hasN8nClientSecret: false, aiEnabled: false },
    });
    expect((await remove.execute(actor('OWNER'), 'c1')).kind).toBe('ok');
  });
});
