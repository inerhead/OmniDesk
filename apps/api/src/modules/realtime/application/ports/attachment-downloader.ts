/** Descarga del media entrante (`attachment.download_requested`), con los reintentos del Outbox. */
export interface AttachmentDownloader {
  /** Lanza `PermanentDownloadError` si reintentar no sirve; cualquier otro error se reintenta. */
  process(tenantId: string, payload: unknown): Promise<void>;
  /** Agotados los intentos o ante un error permanente: el adjunto pasa a FAILED. */
  fail(tenantId: string, payload: unknown, reason: string): Promise<void>;
}

export const ATTACHMENT_DOWNLOADER = Symbol('ATTACHMENT_DOWNLOADER');
