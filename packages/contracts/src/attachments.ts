import { z } from 'zod';

export const AttachmentKindSchema = z.enum(['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER']);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

/** `PENDING`: entrante aún sin descargar de WhatsApp. */
export const AttachmentStatusSchema = z.enum(['PENDING', 'READY', 'FAILED']);
export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>;

export const AttachmentSchema = z.object({
  id: z.uuid(),
  kind: AttachmentKindSchema,
  mimeType: z.string(),
  fileName: z.string().nullable(),
  sizeBytes: z.int().min(0).nullable(),
  /** Nota de voz grabada en WhatsApp. */
  voice: z.boolean(),
  status: AttachmentStatusSchema,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

const MB = 1024 * 1024;

/** Tope del multipart: el mayor de `OUTBOUND_ATTACHMENT_TYPES`. */
export const MAX_OUTBOUND_ATTACHMENT_BYTES = 16 * MB;
/** Pie de foto máximo de WhatsApp Cloud API. */
export const MAX_ATTACHMENT_CAPTION_LENGTH = 1024;

/** Tipos que el agente puede enviar (WhatsApp Cloud API). El documento se acota a 16 MB, Meta admite 100. */
export const OUTBOUND_ATTACHMENT_TYPES: Readonly<
  Record<string, { kind: AttachmentKind; maxBytes: number }>
> = {
  'image/jpeg': { kind: 'IMAGE', maxBytes: 5 * MB },
  'image/png': { kind: 'IMAGE', maxBytes: 5 * MB },
  'video/mp4': { kind: 'VIDEO', maxBytes: 16 * MB },
  'video/3gpp': { kind: 'VIDEO', maxBytes: 16 * MB },
  'audio/aac': { kind: 'AUDIO', maxBytes: 16 * MB },
  'audio/amr': { kind: 'AUDIO', maxBytes: 16 * MB },
  'audio/mpeg': { kind: 'AUDIO', maxBytes: 16 * MB },
  'audio/mp4': { kind: 'AUDIO', maxBytes: 16 * MB },
  /** Meta solo acepta ogg con códec opus. */
  'audio/ogg': { kind: 'AUDIO', maxBytes: 16 * MB },
  'application/pdf': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'text/plain': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/msword': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'DOCUMENT',
    maxBytes: 16 * MB,
  },
  'application/vnd.ms-excel': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'DOCUMENT',
    maxBytes: 16 * MB,
  },
  'application/vnd.ms-powerpoint': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'DOCUMENT',
    maxBytes: 16 * MB,
  },
};

/** `accept` del input de archivo de la web. */
export const OUTBOUND_ATTACHMENT_ACCEPT = [
  ...Object.keys(OUTBOUND_ATTACHMENT_TYPES),
  '.m4a',
].join(',');

const MIME_ALIASES: Readonly<Record<string, string>> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'image/jpg': 'image/jpeg',
};

/** Minúsculas, sin parámetros (`; codecs=…`) y con los alias que declaran algunos navegadores. */
export function normalizeMimeType(mimeType: string): string {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

export type OutboundAttachmentRejection =
  | 'UNSUPPORTED_TYPE'
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'CAPTION_NOT_ALLOWED'
  | 'CAPTION_TOO_LONG';

export type OutboundAttachmentCheck =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; reason: OutboundAttachmentRejection };

/** Misma validación en la web (antes de subir) y en el API (autoritativa). */
export function checkOutboundAttachment(
  file: { mimeType: string; sizeBytes: number },
  caption: string,
): OutboundAttachmentCheck {
  const mimeType = normalizeMimeType(file.mimeType);
  const rule = Object.hasOwn(OUTBOUND_ATTACHMENT_TYPES, mimeType)
    ? OUTBOUND_ATTACHMENT_TYPES[mimeType]
    : undefined;
  if (!rule) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  if (file.sizeBytes === 0) return { ok: false, reason: 'EMPTY' };
  if (file.sizeBytes > rule.maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (caption.length > MAX_ATTACHMENT_CAPTION_LENGTH)
    return { ok: false, reason: 'CAPTION_TOO_LONG' };
  if (rule.kind === 'AUDIO' && caption.trim()) return { ok: false, reason: 'CAPTION_NOT_ALLOWED' };
  return { ok: true, kind: rule.kind, mimeType };
}

/** Ruta del contenido, relativa a la base del API. */
export function attachmentContentPath(attachmentId: string): string {
  return `/api/v1/attachments/${encodeURIComponent(attachmentId)}/content`;
}

/** Campos de texto de `POST /api/v1/conversations/:id/messages/attachments`; el archivo va en `file`. */
export const SendAgentAttachmentFieldsSchema = z.object({
  /** uuid generado en la web: un reintento por error de red no duplica el mensaje. */
  clientMessageId: z.uuid(),
  caption: z.string().max(MAX_ATTACHMENT_CAPTION_LENGTH).default(''),
});
export type SendAgentAttachmentFields = z.infer<typeof SendAgentAttachmentFieldsSchema>;
