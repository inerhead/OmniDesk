const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/)/;

/** Solo multimedia segura en línea. Un documento (incluido HTML o SVG de un cliente) siempre se descarga. */
export function contentDisposition(mimeType: string, fileName: string | null): string {
  const type = INLINE.test(mimeType) ? 'inline' : 'attachment';
  if (!fileName) return type;
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Sin rutas (`/`, `\`), sin controles y con 255 caracteres como máximo. */
export function cleanFileName(name: string): string {
  // Quita caracteres de control que un nombre de archivo no puede llevar.
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  return base.slice(0, 255) || 'archivo';
}

/** busboy decodifica `filename` como latin1: si eran bytes UTF-8 válidos, se recuperan. */
export function decodeMultipartFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}
