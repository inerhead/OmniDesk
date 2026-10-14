/** Rango de bytes inclusivo, como en `Content-Range`. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Un solo rango `bytes=a-b` (RFC 9110). `null`: sin cabecera, o varios rangos (se sirve entero, lo
 * permite la RFC). `'invalid'`: no satisfacible (416).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText = '', endText = ''] = match;
  if (!startText && !endText) return 'invalid';
  if (!startText) {
    const suffix = Number(endText);
    return suffix === 0 ? 'invalid' : { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1;
  return start >= size || start > end ? 'invalid' : { start, end };
}
