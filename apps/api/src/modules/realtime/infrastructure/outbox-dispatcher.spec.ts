import type { RealtimeEvent, TenantStatusChangedEvent } from '@omnidesk/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { PermanentDownloadError } from '../../attachments/domain/attachment-errors';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { AttachmentDownloader } from '../application/ports/attachment-downloader';
import type { OutboxEventStore, PendingOutboxEvent } from '../application/ports/outbox-event-store';
import type { OutboundMessageSender } from '../application/ports/outbound-message-sender';
import type { RealtimePublisher } from '../application/ports/realtime-publisher';
import type { PushSender } from '../../notifications/application/deliver-push.use-case';
import {
  BATCH_SIZE,
  OutboxDispatcher,
  PUSH_MAX_ATTEMPTS,
  SEND_MAX_RETRIES,
} from './outbox-dispatcher';

const noTransaction: TransactionRunner = {
  run: (work) => work(),
  runDetached: (work) => work(),
};
const T0 = new Date('2026-10-12T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

interface StoredEvent extends PendingOutboxEvent {
  nextAttemptAt: Date;
  publishedAt: Date | null;
  lastError: string | null;
}

class InMemoryStore implements OutboxEventStore {
  readonly events: StoredEvent[] = [];

  add(overrides: Partial<StoredEvent> = {}): StoredEvent {
    const n = this.events.length + 1;
    const event: StoredEvent = {
      id: `e${n}`,
      tenantId: 't1',
      type: 'conversation.changed',
      payload: {
        type: 'conversation.changed',
        conversationId: '0199c0de-0000-7000-8000-000000000001',
        reason: 'message',
        occurredAt: T0.toISOString(),
      } satisfies RealtimeEvent,
      attempts: 0,
      nextAttemptAt: T0,
      publishedAt: null,
      lastError: null,
      ...overrides,
    };
    this.events.push(event);
    return event;
  }

  async lockPending(limit: number, now: Date) {
    return this.events
      .filter((e) => e.publishedAt === null && e.nextAttemptAt <= now)
      .slice(0, limit);
  }

  async markPublished(id: string, at: Date, lastError?: string) {
    const event = this.get(id);
    event.publishedAt = at;
    if (lastError !== undefined) event.lastError = lastError;
  }

  async scheduleRetry(id: string, retry: { attempts: number; error: string; at: Date }) {
    Object.assign(this.get(id), {
      attempts: retry.attempts,
      lastError: retry.error,
      nextAttemptAt: retry.at,
    });
  }

  async deletePublishedBefore(cutoff: Date) {
    const before = this.events.length;
    const kept = this.events.filter((e) => !(e.publishedAt && e.publishedAt < cutoff));
    this.events.splice(0, this.events.length, ...kept);
    return before - this.events.length;
  }

  get(id: string): StoredEvent {
    const found = this.events.find((e) => e.id === id);
    if (!found) throw new Error(`sin evento ${id}`);
    return found;
  }
}

class FakePublisher implements RealtimePublisher {
  readonly published: { tenantId: string; event: RealtimeEvent }[] = [];
  failWith: Error | null = null;

  readonly statuses: { tenantId: string; event: TenantStatusChangedEvent }[] = [];

  publish(tenantId: string, event: RealtimeEvent): void {
    if (this.failWith) throw this.failWith;
    this.published.push({ tenantId, event });
  }

  publishTenantStatus(tenantId: string, event: TenantStatusChangedEvent): void {
    if (this.failWith) throw this.failWith;
    this.statuses.push({ tenantId, event });
  }
}

/** Proveedor falso: falla las primeras `failures` veces. */
class FakeSender implements OutboundMessageSender {
  readonly sent: unknown[] = [];
  readonly failed: { payload: unknown; reason: string }[] = [];
  calls = 0;
  failures = 0;

  async send(_tenantId: string, payload: unknown) {
    this.calls += 1;
    if (this.calls <= this.failures) throw new Error(`proveedor caído (${this.calls})`);
    this.sent.push(payload);
  }

  async fail(_tenantId: string, payload: unknown, reason: string) {
    this.failed.push({ payload, reason });
  }
}

class FakePush implements PushSender {
  calls = 0;
  platform: unknown[] = [];
  error: Error | null = new Error('push caído');

  async deliver() {
    this.calls += 1;
    if (this.error) throw this.error;
  }

  async deliverPlatform(payload: unknown) {
    this.platform.push(payload);
    if (this.error) throw this.error;
  }
}

class FakeDownloader implements AttachmentDownloader {
  calls = 0;
  error: Error | null = null;
  readonly failed: { payload: unknown; reason: string }[] = [];

  async process() {
    this.calls += 1;
    if (this.error) throw this.error;
  }

  async fail(_tenantId: string, payload: unknown, reason: string) {
    this.failed.push({ payload, reason });
  }
}

describe('OutboxDispatcher', () => {
  let store: InMemoryStore;
  let publisher: FakePublisher;
  let sender: FakeSender;
  let dispatcher: OutboxDispatcher;

  beforeEach(() => {
    store = new InMemoryStore();
    publisher = new FakePublisher();
    sender = new FakeSender();
    dispatcher = new OutboxDispatcher(noTransaction, store, publisher, sender);
  });

  it('publica el evento en el room de su tenant y lo marca como publicado', async () => {
    const event = store.add();

    expect(await dispatcher.tick(T0)).toBe(1);

    expect(publisher.published).toEqual([{ tenantId: 't1', event: event.payload }]);
    expect(event.publishedAt).toEqual(T0);
  });

  it('no vuelve a publicar un evento ya publicado', async () => {
    store.add();

    await dispatcher.tick(T0);
    await dispatcher.tick(new Date(T0.getTime() + 500));

    expect(publisher.published).toHaveLength(1);
  });

  it('ante un fallo programa el reintento con attempts, lastError y nextAttemptAt futuro', async () => {
    const event = store.add();
    publisher.failWith = new Error('socket caído');

    expect(await dispatcher.tick(T0)).toBe(0);

    expect(event).toMatchObject({ attempts: 1, lastError: 'socket caído', publishedAt: null });
    expect(event.nextAttemptAt).toEqual(new Date(T0.getTime() + 2_000));
  });

  it('no reintenta antes de nextAttemptAt y publica en un tick posterior', async () => {
    const event = store.add();
    publisher.failWith = new Error('socket caído');
    await dispatcher.tick(T0);
    publisher.failWith = null;

    await dispatcher.tick(new Date(T0.getTime() + 1_999));
    expect(event.publishedAt).toBeNull();

    await dispatcher.tick(new Date(T0.getTime() + 2_000));
    expect(event.publishedAt).not.toBeNull();
    expect(publisher.published).toHaveLength(1);
  });

  it('duplica la espera en cada fallo (2^attempts s)', async () => {
    const event = store.add({ attempts: 2 });
    publisher.failWith = new Error('x');

    await dispatcher.tick(T0);

    expect(event.attempts).toBe(3);
    expect(event.nextAttemptAt).toEqual(new Date(T0.getTime() + 8_000));
  });

  it('limita la espera a una hora cuando hay muchos fallos', async () => {
    const event = store.add({ attempts: 60 });
    publisher.failWith = new Error('x');

    await dispatcher.tick(T0);

    expect(event.nextAttemptAt).toEqual(new Date(T0.getTime() + HOUR));
  });

  it('un fallo no impide publicar el resto del lote', async () => {
    const bad = store.add({ type: 'desconocido' });
    const good = store.add();

    expect(await dispatcher.tick(T0)).toBe(1);

    expect(bad).toMatchObject({ attempts: 1, publishedAt: null });
    expect(bad.lastError).toContain('desconocido');
    expect(good.publishedAt).toEqual(T0);
  });

  it('trata un payload inválido como un fallo y no lo publica', async () => {
    const event = store.add({ payload: { type: 'conversation.changed' } });

    await dispatcher.tick(T0);

    expect(publisher.published).toHaveLength(0);
    expect(event.attempts).toBe(1);
    expect(event.lastError).not.toBeNull();
  });

  it('toma como máximo un lote por tick', async () => {
    for (let i = 0; i < BATCH_SIZE + 1; i += 1) store.add();

    expect(await dispatcher.tick(T0)).toBe(BATCH_SIZE);
    expect(await dispatcher.tick(T0)).toBe(1);
  });

  describe('message.send_requested', () => {
    const sendEvent = (overrides: Partial<StoredEvent> = {}) =>
      store.add({
        type: 'message.send_requested',
        payload: { messageId: '0199c0de-0000-7000-8000-0000000000aa' },
        ...overrides,
      });

    it('envía por el proveedor, no por Socket.IO, y lo marca como procesado', async () => {
      const event = sendEvent();

      expect(await dispatcher.tick(T0)).toBe(1);

      expect(sender.sent).toEqual([event.payload]);
      expect(publisher.published).toHaveLength(0);
      expect(event.publishedAt).toEqual(T0);
    });

    it('reintenta con backoff de 1, 2, 4, 8 y 16 s', async () => {
      const event = sendEvent();
      sender.failures = 99;
      let now = T0;
      const waits: number[] = [];

      for (let retry = 0; retry < SEND_MAX_RETRIES; retry += 1) {
        await dispatcher.tick(now);
        waits.push((event.nextAttemptAt.getTime() - now.getTime()) / 1000);
        now = event.nextAttemptAt;
      }

      expect(waits).toEqual([1, 2, 4, 8, 16]);
      expect(event.attempts).toBe(5);
    });

    it('no reintenta antes de tiempo y se recupera cuando el proveedor vuelve', async () => {
      const event = sendEvent();
      sender.failures = 2;

      await dispatcher.tick(T0); // falla: +1 s
      await dispatcher.tick(new Date(T0.getTime() + 999)); // aún no toca
      await dispatcher.tick(new Date(T0.getTime() + 1_000)); // falla: +2 s
      expect(sender.calls).toBe(2);
      await dispatcher.tick(new Date(T0.getTime() + 3_000)); // éxito

      expect(sender.sent).toHaveLength(1);
      expect(sender.failed).toHaveLength(0);
      expect(event).toMatchObject({ attempts: 2 });
      expect(event.publishedAt).not.toBeNull();
    });

    it('tras agotar los reintentos (≈ 31 s) marca el mensaje como FAILED y cierra el evento', async () => {
      const event = sendEvent();
      sender.failures = 99;
      let now = T0;

      for (let call = 0; call <= SEND_MAX_RETRIES; call += 1) {
        await dispatcher.tick(now);
        now = event.nextAttemptAt;
      }

      expect(sender.calls).toBe(6);
      expect(sender.failed).toEqual([{ payload: event.payload, reason: 'proveedor caído (6)' }]);
      expect(event.attempts).toBe(5);
      expect(event.lastError).toBe('proveedor caído (6)');
      expect(event.publishedAt).not.toBeNull();
      expect(now.getTime() - T0.getTime()).toBe(31_000);

      await dispatcher.tick(new Date(now.getTime() + 60_000));
      expect(sender.calls).toBe(6);
    });
  });

  describe('limpieza', () => {
    it('borra los publicados hace más de 24 h y conserva el resto', async () => {
      const old = store.add({ publishedAt: new Date(T0.getTime() - 25 * HOUR) });
      const recent = store.add({ publishedAt: new Date(T0.getTime() - 23 * HOUR) });
      const pending = store.add();

      expect(await dispatcher.cleanup(T0)).toBe(1);

      expect(store.events).toEqual([recent, pending]);
      expect(store.events).not.toContain(old);
    });
  });

  describe('attachment.download_requested', () => {
    let downloader: FakeDownloader;
    const downloadEvent = () =>
      store.add({
        type: 'attachment.download_requested',
        payload: {
          attachmentId: '0199c0de-0000-7000-8000-0000000000f1',
          channelId: '0199c0de-0000-7000-8000-0000000000c1',
        },
      });

    beforeEach(() => {
      downloader = new FakeDownloader();
      dispatcher = new OutboxDispatcher(
        noTransaction,
        store,
        publisher,
        sender,
        undefined,
        downloader,
      );
    });

    it('descarga y cierra el evento', async () => {
      const event = downloadEvent();
      expect(await dispatcher.tick(T0)).toBe(1);
      expect(downloader.calls).toBe(1);
      expect(event.publishedAt).toEqual(T0);
    });

    it('un error transitorio se reintenta 5 veces y después marca FAILED', async () => {
      const event = downloadEvent();
      downloader.error = new Error('Graph caído');
      let now = T0;
      for (let call = 0; call <= SEND_MAX_RETRIES; call += 1) {
        await dispatcher.tick(now);
        now = event.nextAttemptAt;
      }
      expect(downloader.calls).toBe(6);
      expect(downloader.failed).toEqual([{ payload: event.payload, reason: 'Graph caído' }]);
      expect(event.publishedAt).not.toBeNull();
    });

    it('un error permanente marca FAILED sin reintentar', async () => {
      const event = downloadEvent();
      downloader.error = new PermanentDownloadError('TOO_LARGE: 99 bytes');
      await dispatcher.tick(T0);
      expect(downloader.calls).toBe(1);
      expect(downloader.failed).toHaveLength(1);
      expect(event.publishedAt).toEqual(T0);
    });
  });

  describe('notification.requested', () => {
    let push: FakePush;

    beforeEach(() => {
      push = new FakePush();
      dispatcher = new OutboxDispatcher(
        noTransaction,
        store,
        publisher,
        sender,
        undefined,
        undefined,
        push,
      );
    });

    it('entrega y cierra el evento', async () => {
      push.error = null;
      const event = store.add({ type: 'notification.requested', payload: { kind: 'assigned' } });
      expect(await dispatcher.tick(T0)).toBe(1);
      expect(push.calls).toBe(1);
      expect(event.publishedAt).toEqual(T0);
    });

    it('reintenta dos veces (1 s y 2 s) y luego descarta el aviso', async () => {
      const event = store.add({ type: 'notification.requested', payload: { kind: 'assigned' } });
      const waits: number[] = [];
      let now = T0;

      for (let attempt = 0; attempt < PUSH_MAX_ATTEMPTS; attempt += 1) {
        await dispatcher.tick(now);
        if (event.publishedAt) break;
        waits.push((event.nextAttemptAt.getTime() - now.getTime()) / 1000);
        now = event.nextAttemptAt;
      }

      expect(waits).toEqual([1, 2]);
      expect(push.calls).toBe(3);
      expect(event.publishedAt).toEqual(now);
      expect(event.lastError).toBe('push caído');
    });
  });
});

describe('OutboxDispatcher con la empresa inactiva (SPEC 16)', () => {
  let store: InMemoryStore;
  let publisher: FakePublisher;
  let sender: FakeSender;
  let push: FakePush;
  let dispatcher: OutboxDispatcher;
  const inactive = { state: async () => 'inactive' as const, isActive: async () => false };

  beforeEach(() => {
    store = new InMemoryStore();
    publisher = new FakePublisher();
    sender = new FakeSender();
    push = new FakePush();
    push.error = null;
    dispatcher = new OutboxDispatcher(
      noTransaction,
      store,
      publisher,
      sender,
      undefined,
      undefined,
      push,
      inactive,
    );
  });

  it('un envío en cola pasa a FAILED con TENANT_INACTIVE sin llamar al proveedor', async () => {
    const payload = { messageId: '0199c0de-0000-7000-8000-0000000000a1' };
    const event = store.add({ type: 'message.send_requested', payload });

    await dispatcher.tick(T0);

    expect(sender.calls).toBe(0);
    expect(sender.failed).toEqual([{ payload, reason: 'TENANT_INACTIVE' }]);
    expect(event.publishedAt).toEqual(T0);
  });

  it('las notificaciones se publican sin enviarse', async () => {
    const event = store.add({ type: 'notification.requested', payload: { kind: 'assigned' } });

    await dispatcher.tick(T0);

    expect(push.calls).toBe(0);
    expect(event.publishedAt).toEqual(T0);
  });

  it('el aviso de estado y los cambios de conversación sí se publican', async () => {
    store.add();
    const status = store.add({
      type: 'tenant.status_changed',
      payload: {
        type: 'tenant.status_changed',
        tenantId: '0199c0de-0000-7000-8000-0000000000e1',
        active: false,
        occurredAt: T0.toISOString(),
      },
    });

    expect(await dispatcher.tick(T0)).toBe(2);

    expect(publisher.published).toHaveLength(1);
    expect(publisher.statuses).toEqual([{ tenantId: 't1', event: status.payload }]);
  });
});

describe('OutboxDispatcher: push de plataforma (SPEC 18)', () => {
  const platformPush = {
    userIds: ['0199c0de-0000-7000-8000-0000000000b1'],
    title: 'Solicitud rechazada',
    body: 'Acme: datos falsos',
    url: '/onboarding',
    tag: 'tenant-request-x',
  };

  it.each([
    ['en revisión', 'pending' as const],
    ['borrada', null],
  ])('se entrega con la empresa %s', async (_label, state) => {
    const store = new InMemoryStore();
    const push = new FakePush();
    push.error = null;
    const dispatcher = new OutboxDispatcher(
      noTransaction,
      store,
      new FakePublisher(),
      new FakeSender(),
      undefined,
      undefined,
      push,
      { state: async () => state, isActive: async () => false },
    );
    const event = store.add({ type: 'platform.push_requested', payload: platformPush });

    await dispatcher.tick(T0);

    expect(push.platform).toEqual([platformPush]);
    expect(event.publishedAt).toEqual(T0);
  });

  it('un fallo se reintenta como el resto de push', async () => {
    const store = new InMemoryStore();
    const push = new FakePush();
    const dispatcher = new OutboxDispatcher(
      noTransaction,
      store,
      new FakePublisher(),
      new FakeSender(),
      undefined,
      undefined,
      push,
    );
    const event = store.add({ type: 'platform.push_requested', payload: platformPush });

    await dispatcher.tick(T0);

    expect(event.publishedAt).toBeNull();
    expect(event.attempts).toBe(1);
  });
});
