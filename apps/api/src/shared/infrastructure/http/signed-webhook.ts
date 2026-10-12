import { signPayload, SIGNATURE_HEADER } from '../crypto/hmac-signature';

export interface SignedWebhookResponse {
  status: number;
  /** Cuerpo JSON, o `null` si no lo es. */
  json: unknown;
  latencyMs: number;
}

/**
 * POST de un cuerpo JSON firmado (`X-OmniDesk-Signature`) a un webhook de integración. Lanza si no
 * hay respuesta (red, DNS o timeout). No sigue redirecciones: un webhook que redirige no es válido.
 */
export async function postSignedJson(
  url: string,
  secret: string,
  body: object,
  {
    nowSec,
    timeoutMs,
    headers = {},
  }: { nowSec: number; timeoutMs: number; headers?: Record<string, string> },
): Promise<SignedWebhookResponse> {
  const raw = JSON.stringify(body);
  const started = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: signPayload(secret, raw, nowSec),
      ...headers,
    },
    body: raw,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json, latencyMs: Math.round(performance.now() - started) };
}

/** Mensaje legible de un error de `fetch` (timeout, conexión rechazada, DNS…). */
export function describeFetchError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return 'Tiempo de espera agotado';
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ?? cause?.message ?? error.message;
  }
  return String(error);
}
