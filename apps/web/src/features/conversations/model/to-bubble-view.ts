import type { Message } from '@omnidesk/contracts';

/** Icono de entrega de los mensajes salientes (lucide: Clock, Check, CheckCheck, CheckCheck azul, AlertCircle). */
export type DeliveryIcon = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface BubbleView {
  /** `start` = izquierda (cliente); `end` = derecha (IA y agentes). */
  align: 'start' | 'end';
  tone: 'customer' | 'ai' | 'agent';
  /** Etiqueta del autor (el nombre del agente); el cliente no la lleva. */
  label: string | null;
  /** Registrado pero sin confirmación de envío del proveedor. */
  pending: boolean;
  /** Estado de entrega; los mensajes del cliente no lo llevan. */
  deliveryIcon: DeliveryIcon | null;
  /** Falló y un agente puede reenviarlo (la IA no reintenta desde la web). */
  canRetry: boolean;
}

const DELIVERY_ICONS: Partial<Record<Message['status'], DeliveryIcon>> = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
};

export function toBubbleView(
  message: Pick<Message, 'senderType' | 'status'> & Partial<Pick<Message, 'sender'>>,
): BubbleView {
  const pending = message.status === 'PENDING';
  const deliveryIcon = DELIVERY_ICONS[message.status] ?? null;
  switch (message.senderType) {
    case 'CUSTOMER':
      return {
        align: 'start',
        tone: 'customer',
        label: null,
        pending,
        deliveryIcon: null,
        canRetry: false,
      };
    case 'AI':
      return { align: 'end', tone: 'ai', label: 'IA', pending, deliveryIcon, canRetry: false };
    case 'AGENT':
      return {
        align: 'end',
        tone: 'agent',
        label: message.sender?.displayName ?? 'Agente',
        pending,
        deliveryIcon,
        canRetry: message.status === 'FAILED',
      };
  }
}

/** Nombre visible del contacto: su nombre o, si no lo hay, su teléfono. */
export function contactLabel(contact: { displayName: string | null; externalId: string }): string {
  return contact.displayName ?? contact.externalId;
}
