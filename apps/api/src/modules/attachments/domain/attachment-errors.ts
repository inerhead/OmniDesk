/** Reintentar no sirve (sin token, archivo demasiado grande, media borrado): el adjunto pasa a FAILED. */
export class PermanentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDownloadError';
  }
}
