export type AttachmentKind = 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'STICKER';
/** `PENDING`: entrante aún sin descargar de WhatsApp. */
export type AttachmentStatus = 'PENDING' | 'READY' | 'FAILED';

/** Archivo del mensaje, tal como se lee. */
export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
  voice: boolean;
  status: AttachmentStatus;
  /** Clave del objeto en el bucket; null mientras está PENDING. */
  storageKey: string | null;
}

/** Archivo de un mensaje nuevo. */
export interface NewAttachment {
  kind: AttachmentKind;
  mimeType: string;
  status: AttachmentStatus;
  fileName?: string;
  sizeBytes?: number;
  voice?: boolean;
  sha256?: string;
  providerMediaId?: string;
  storageKey?: string;
}

export type SenderType = 'CUSTOMER' | 'AI' | 'AGENT';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'RECEIVED' | 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  conversationId: string;
  channelId: string;
  sequence: number;
  direction: MessageDirection;
  senderType: SenderType;
  text: string;
  status: MessageStatus;
  /** Entrantes: id del mensaje en el proveedor. Salientes: el `providerMessageId` del envío. */
  externalId: string | null;
  /** Agente que lo escribió (solo `AGENT`). */
  sender: { id: string; displayName: string } | null;
  failureReason: string | null;
  attachment: MessageAttachment | null;
  createdAt: Date;
}

/** Datos de un mensaje antes de asignarle `sequence`. */
export interface NewMessage {
  direction: MessageDirection;
  senderType: SenderType;
  text: string;
  status: MessageStatus;
  externalId?: string;
  idempotencyKey?: string;
  providerTimestamp?: Date;
  /** Agente que escribe (solo `AGENT`). */
  senderMemberId?: string;
  /** Idempotencia del composer de la web. */
  clientMessageId?: string;
  attachment?: NewAttachment;
}

/** Mensaje del cliente: entrante y ya recibido. Con adjunto, `text` es el pie (puede ser vacío). */
export function customerMessage(
  text: string,
  externalId: string,
  providerTimestamp: Date,
  attachment?: NewAttachment,
): NewMessage {
  return {
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    status: 'RECEIVED',
    text,
    externalId,
    providerTimestamp,
    ...(attachment && { attachment }),
  };
}

/** Respuesta de IA: saliente y pendiente de confirmación del proveedor. */
export function aiReply(text: string, idempotencyKey: string): NewMessage {
  return { direction: 'OUTBOUND', senderType: 'AI', status: 'PENDING', text, idempotencyKey };
}

/** Mensaje del agente: saliente y pendiente de que el proveedor lo confirme. */
export function agentMessage(
  text: string,
  senderMemberId: string,
  clientMessageId: string,
  attachment?: NewAttachment,
): NewMessage {
  return {
    direction: 'OUTBOUND',
    senderType: 'AGENT',
    status: 'PENDING',
    text,
    senderMemberId,
    clientMessageId,
    ...(attachment && { attachment }),
  };
}

const KIND_LABELS: Record<AttachmentKind, string> = {
  IMAGE: 'Foto',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  STICKER: 'Sticker',
  DOCUMENT: 'Documento',
};

/** Texto del que sale la vista previa de la lista: el texto o, con adjunto, su tipo y el pie. */
export function previewSource(message: Pick<NewMessage, 'text' | 'attachment'>): string {
  const { attachment, text } = message;
  if (!attachment) return text;
  const label = attachment.voice
    ? 'Nota de voz'
    : attachment.kind === 'DOCUMENT' && attachment.fileName
      ? `Documento: ${attachment.fileName}`
      : KIND_LABELS[attachment.kind];
  return text.trim() ? `${label} · ${text}` : label;
}
