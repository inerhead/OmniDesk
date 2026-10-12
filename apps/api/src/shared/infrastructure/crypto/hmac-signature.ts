import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cabecera de la firma HMAC en ambas direcciones (OmniDesk ↔ n8n). */
export const SIGNATURE_HEADER = 'x-omnidesk-signature';
/** Desfase máximo entre `t` y el reloj del receptor. */
export const SIGNATURE_TOLERANCE_SEC = 300;

export type SignatureCheck = 'ok' | 'missing' | 'malformed' | 'expired' | 'mismatch';

function hmacHex(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** `t=<unix_segundos>,v1=<hex(HMAC_SHA256(secreto, t + "." + cuerpo_crudo))>` */
export function signPayload(secret: string, rawBody: string, nowSec: number): string {
  const t = Math.floor(nowSec);
  return `t=${t},v1=${hmacHex(secret, t, rawBody)}`;
}

/** Lee `t` y `v1` de la cabecera; `null` si no tiene ese formato. */
export function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts = new Map<string, string>();
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) return null;
    parts.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  const t = parts.get('t');
  const v1 = parts.get('v1');
  if (!t || !/^\d{1,12}$/.test(t) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { t: Number(t), v1: v1.toLowerCase() };
}

/**
 * Verifica la firma contra los bytes recibidos (nunca contra el JSON reserializado). Acepta
 * cualquiera de `secrets` (el actual y, durante una rotación, el anterior). Comparación en tiempo
 * constante.
 */
export function verifySignature(
  header: string | undefined,
  rawBody: string,
  secrets: string[],
  nowSec: number,
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
): SignatureCheck {
  if (!header) return 'missing';
  const parsed = parseSignatureHeader(header);
  if (!parsed) return 'malformed';
  if (Math.abs(nowSec - parsed.t) > toleranceSec) return 'expired';
  const received = Buffer.from(parsed.v1, 'hex');
  for (const secret of secrets) {
    const expected = Buffer.from(hmacHex(secret, parsed.t, rawBody), 'hex');
    if (timingSafeEqual(expected, received)) return 'ok';
  }
  return 'mismatch';
}
