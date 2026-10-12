import { env } from '@/shared/config/env';
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
}

async function requestJson(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} }: RequestOptions,
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${env.VITE_API_URL}${path}`, {
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
    return { status: res.status, body: json };
  } catch (error) {
    throw new ApiUnavailableError(error);
  } finally {
    clearTimeout(timer);
  }
}

/** GET contra el API (`${VITE_API_URL}/api/v1/...`) con timeout y `x-request-id` por petición. */
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
