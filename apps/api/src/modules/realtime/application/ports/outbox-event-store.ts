export interface PendingOutboxEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxEventStore {
  /**
   * Toma hasta `limit` eventos pendientes cuyo `nextAttemptAt` ya pasó, del más antiguo al más nuevo,
   * bloqueándolos hasta el fin de la transacción activa (`FOR UPDATE SKIP LOCKED`).
   */
  lockPending(limit: number, now: Date): Promise<PendingOutboxEvent[]>;
  /** Marca el evento como procesado; `lastError` queda si se abandonó tras agotar los intentos. */
  markPublished(id: string, at: Date, lastError?: string): Promise<void>;
  scheduleRetry(id: string, retry: { attempts: number; error: string; at: Date }): Promise<void>;
  /** Borra los eventos publicados antes de `cutoff`. Devuelve cuántos borró. */
  deletePublishedBefore(cutoff: Date): Promise<number>;
}

export const OUTBOX_EVENT_STORE = Symbol('OUTBOX_EVENT_STORE');
