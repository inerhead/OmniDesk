export interface EventInbox {
  /**
   * Registra el reporte de una integración. Devuelve `false` si ya estaba registrado
   * (`INSERT … ON CONFLICT DO NOTHING`: no aborta la transacción activa).
   */
  recordIfNew(channelId: string, externalId: string): Promise<boolean>;
}

export const EVENT_INBOX = Symbol('EVENT_INBOX');
