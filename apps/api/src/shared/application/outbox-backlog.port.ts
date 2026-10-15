/** Eventos del Outbox aún sin publicar (SPEC 11): métricas y `/health`. Ve todas las empresas. */
export interface OutboxBacklog {
  pendingByType(): Promise<Array<{ type: string; count: number }>>;
  /** `created_at` del pendiente más antiguo, o `null` si no hay ninguno. */
  oldestPendingCreatedAt(): Promise<Date | null>;
}

export const OUTBOX_BACKLOG = Symbol('OUTBOX_BACKLOG');
