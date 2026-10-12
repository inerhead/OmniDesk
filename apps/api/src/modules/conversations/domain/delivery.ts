import type { MessageStatus } from './message';

export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** Estados a los que se puede llegar desde cada estado actual (SPEC 05, tabla de transiciones). */
const ALLOWED: Partial<Record<MessageStatus, readonly DeliveryStatus[]>> = {
  PENDING: ['SENT', 'DELIVERED', 'READ', 'FAILED'],
  SENT: ['DELIVERED', 'READ', 'FAILED'],
  DELIVERED: ['READ'],
  READ: [],
  // Un reintento exitoso devuelve el mensaje a SENT; un reporte tardío no lo mueve más.
  FAILED: ['SENT'],
};

/**
 * Los estados de entrega solo avanzan: `READ` nunca vuelve a `DELIVERED`, y `FAILED` solo se
 * acepta desde `PENDING` o `SENT`. Un reporte que no aplica se ignora (el API responde `200`).
 * Los mensajes entrantes (`RECEIVED`) no tienen estado de entrega.
 */
export function canTransitionDelivery(from: MessageStatus, to: DeliveryStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
