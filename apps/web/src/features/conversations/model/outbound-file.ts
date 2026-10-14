import { checkOutboundAttachment, type OutboundAttachmentRejection } from '@omnidesk/contracts';

export interface Draft {
  text: string;
  file: File | null;
}

const MESSAGES: Record<OutboundAttachmentRejection, string> = {
  UNSUPPORTED_TYPE: 'Tipo de archivo no admitido. Usa JPG, PNG, PDF, Office, texto, audio o MP4',
  EMPTY: 'El archivo está vacío',
  TOO_LARGE: 'El archivo es demasiado grande: imágenes hasta 5 MB, el resto hasta 16 MB',
  CAPTION_NOT_ALLOWED: 'Los audios se envían sin texto',
  CAPTION_TOO_LONG: 'El texto de un adjunto admite hasta 1024 caracteres',
};

/** `null` si se puede enviar; si no, el aviso para el agente. Misma regla que el API. */
export function outboundFileProblem(
  file: { type: string; size: number },
  caption: string,
): string | null {
  const check = checkOutboundAttachment({ mimeType: file.type, sizeBytes: file.size }, caption);
  return check.ok ? null : MESSAGES[check.reason];
}

/** Identifica el borrador: si cambia, el envío lleva un `clientMessageId` nuevo. */
export function draftKey({ text, file }: Draft): string {
  return `${text}\u0000${file ? `${file.name}:${file.size}:${file.lastModified}` : ''}`;
}
