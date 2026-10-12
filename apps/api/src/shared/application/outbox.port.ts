/**
 * Puerto del Outbox transaccional (arquitectura §3): el evento se guarda en la misma
 * transacción que el cambio y un dispatcher lo publica después.
 */
export interface OutboxPort {
  /** Encola un evento en la transacción activa. Debe llamarse dentro de `TransactionRunner.run`. */
  enqueue(event: {
    tenantId: string;
    type: 'conversation.changed';
    payload: object;
  }): Promise<void>;
}

export const OUTBOX_PORT = Symbol('OUTBOX_PORT');
