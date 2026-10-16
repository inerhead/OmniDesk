export interface WebhookResponse {
  status: number;
  /** Cuerpo JSON, o `null` si no lo es. */
  json: unknown;
  latencyMs: number;
}

/**
 * POST de un cuerpo JSON a un webhook de integración, sin firma: n8n autentica con las cabeceras de
 * cliente que pasa quien llama (SPEC 22). Lanza si no hay respuesta (red, DNS o timeout). No sigue
 * redirecciones: un webhook que redirige no es válido.
 */
export async function postJson(
  url: string,
  body: object,
  { timeoutMs, headers = {} }: { timeoutMs: number; headers?: Record<string, string> },
): Promise<WebhookResponse> {
  const raw = JSON.stringify(body);
  const started = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
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
