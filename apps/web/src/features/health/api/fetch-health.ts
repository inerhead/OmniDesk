import { HealthResponseSchema, type HealthResponse } from '@omnidesk/contracts';
import { ApiUnavailableError, getJson } from '@/shared/api/http-client';

/** 200 y 503 son respuestas válidas del API. Cualquier otra cosa (p. ej. 502 de Caddy) = API no disponible. */
export async function fetchHealth(): Promise<HealthResponse> {
  const { status, body } = await getJson('/api/v1/health');
  if (status !== 200 && status !== 503) {
    throw new ApiUnavailableError(`HTTP ${status}`);
  }

  const parsed = HealthResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiUnavailableError(parsed.error);
  }
  return parsed.data;
}
