import type { Message } from '@omnidesk/contracts';

export interface BubbleView {
  /** `start` = izquierda (cliente); `end` = derecha (IA y agentes). */
  align: 'start' | 'end';
  tone: 'customer' | 'ai' | 'agent';
  /** Etiqueta del autor; el cliente no la lleva. */
  label: string | null;
  /** Registrado pero sin confirmación de envío del proveedor. */
  pending: boolean;
}

export function toBubbleView(message: Pick<Message, 'senderType' | 'status'>): BubbleView {
  const pending = message.status === 'PENDING';
  switch (message.senderType) {
    case 'CUSTOMER':
      return { align: 'start', tone: 'customer', label: null, pending };
    case 'AI':
      return { align: 'end', tone: 'ai', label: 'IA', pending };
    case 'AGENT':
      return { align: 'end', tone: 'agent', label: 'Agente', pending };
  }
}

/** Nombre visible del contacto: su nombre o, si no lo hay, su teléfono. */
export function contactLabel(contact: { displayName: string | null; externalId: string }): string {
  return contact.displayName ?? contact.externalId;
}
