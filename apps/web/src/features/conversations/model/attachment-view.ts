import { attachmentContentPath, type Attachment } from '@omnidesk/contracts';

export interface AttachmentView {
  variant: 'image' | 'sticker' | 'video' | 'audio' | 'document';
  state: 'pending' | 'ready' | 'failed';
  src: string;
  label: string;
  fileName: string | null;
  sizeLabel: string | null;
}

const LABELS: Record<Attachment['kind'], string> = {
  IMAGE: 'Foto',
  STICKER: 'Sticker',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  DOCUMENT: 'Documento',
};

/** `base` = `apiBase` (vacío o la subruta): la URL es del mismo origen y lleva la cookie. */
export function toAttachmentView(attachment: Attachment, base: string): AttachmentView {
  return {
    variant: attachment.kind.toLowerCase() as AttachmentView['variant'],
    state: attachment.status.toLowerCase() as AttachmentView['state'],
    src: `${base}${attachmentContentPath(attachment.id)}`,
    label: attachment.voice ? 'Nota de voz' : LABELS[attachment.kind],
    fileName: attachment.fileName,
    sizeLabel: attachment.sizeBytes === null ? null : formatBytes(attachment.sizeBytes),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}
