import type { RealtimeEvent } from '@omnidesk/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { OutboxEventStore, PendingOutboxEvent } from '../application/ports/outbox-event-store';
import type { RealtimePublisher } from '../application/ports/realtime-publisher';
import { BATCH_SIZE, OutboxDispatcher } from './outbox-dispatcher';

const noTransaction: TransactionRunner = { run: (work) => work() };
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

  async markPublished(id: string, at: Date) {
    this.get(id).publishedAt = at;
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

  publish(tenantId: string, event: RealtimeEvent): void {
    if (this.failWith) throw this.failWith;
    this.published.push({ tenantId, event });
  }
}

describe('OutboxDispatcher', () => {
  let store: InMemoryStore;
  let publisher: FakePublisher;
  let dispatcher: OutboxDispatcher;

  beforeEach(() => {
    store = new InMemoryStore();
    publisher = new FakePublisher();
    dispatcher = new OutboxDispatcher(noTransaction, store, publisher);
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
});
