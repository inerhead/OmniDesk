import { apiBase } from '@/shared/config/env';
import { newRequestId } from './request-id';

const DEFAULT_TIMEOUT_MS = 3_000;

/** El API no respondió (red caída, timeout o gateway sin backend). */
export class ApiUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('API no disponible', { cause });
    this.name = 'ApiUnavailableError';
  }
}

/** El API respondió con un estado inesperado. */
export class ApiHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'ApiHttpError';
  }
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface RequestOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Un `401` es una respuesta esperada (p. ej. `/me` en una pantalla pública): no cierra la sesión. */
  allowUnauthorized?: boolean;
}

let onUnauthorized: (() => void) | null = null;

/**
 * Qué hacer ante un `401` en cualquier petición: la app limpia la caché, desconecta el socket y
 * redirige a `/login?next=`. Devuelve la función que lo quita.
 */
export function setUnauthorizedHandler(handler: () => void): () => void {
  onUnauthorized = handler;
  return () => {
    if (onUnauthorized === handler) onUnauthorized = null;
  };
}

async function requestJson(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, allowUnauthorized = false }: RequestOptions,
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: ApiResponse;

  try {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        'x-request-id': newRequestId(),
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      credentials: 'include',
      signal: controller.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    response = { status: res.status, body: json };
  } catch (error) {
    throw new ApiUnavailableError(error);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 && !allowUnauthorized) onUnauthorized?.();
  return response;
}

/** GET contra el API (`${apiBase}/api/v1/...`; mismo origen: `/omnidesk/api/v1/...`) con timeout y `x-request-id` por petición. */
export function getJson(path: string, options: RequestOptions = {}): Promise<ApiResponse> {
  return requestJson('GET', path, undefined, options);
}

/** POST con cuerpo JSON. Igual que `getJson`, devuelve el estado y el cuerpo sin interpretarlos. */
export function postJson(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  return requestJson('POST', path, body, options);
}

/** PATCH con cuerpo JSON. */
export function patchJson(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  return requestJson('PATCH', path, body, options);
}

/** DELETE sin cuerpo. */
export function deleteJson(path: string, options: RequestOptions = {}): Promise<ApiResponse> {
  return requestJson('DELETE', path, undefined, options);
}
