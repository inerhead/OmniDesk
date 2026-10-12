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

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** GET contra el API (`${VITE_API_URL}/api/v1/...`) con timeout y `x-request-id` por petición. */
export async function getJson(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${env.VITE_API_URL}${path}`, {
      headers: { accept: 'application/json', 'x-request-id': newRequestId() },
      credentials: 'include',
      signal: controller.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (error) {
    throw new ApiUnavailableError(error);
  } finally {
    clearTimeout(timer);
  }
}
