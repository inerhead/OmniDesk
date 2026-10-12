import { z } from 'zod';

/** Respuesta de `GET /api/v1/health`. Compartida por el API y la web. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: z.enum(['up', 'down']) }),
  /** Versión de apps/api/package.json. */
  version: z.string(),
  /** Fecha ISO 8601 del chequeo. */
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
