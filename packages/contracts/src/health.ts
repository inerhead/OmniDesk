import { z } from 'zod';

/** Respuesta de `GET /api/v1/health`. Compartida por el API y la web. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: z.enum(['up', 'down']) }),
  /** Versión desplegada (`APP_VERSION`: etiqueta o commit); `dev` sin ella. */
  version: z.string(),
  /** Outbox (SPEC 11): `lagging` si el pendiente más antiguo supera el umbral; `unknown` si no se pudo leer. */
  outbox: z.enum(['ok', 'lagging', 'unknown']),
  /** Fecha ISO 8601 del chequeo. */
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * `GET /api/v1/health/live` (SPEC 19): el proceso responde; no mira la base. Lo usa el healthcheck
 * del contenedor, para que autoheal no reinicie el API cuando la que falla es la base.
 */
export const HealthLiveResponseSchema = z.object({ status: z.literal('ok') });
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;
