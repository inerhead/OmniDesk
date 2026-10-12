import { z } from 'zod';

/**
 * Variables de entorno de la web (se resuelven en tiempo de build).
 * Lo comparten `vite.config.ts` (falla el build) y `env.ts` (falla el arranque).
 */
export const WebEnvSchema = z.object({
  // Vacía = mismo origen (`/api/...` detrás de Caddy). Si no, URL absoluta del API, sin barra final.
  VITE_API_URL: z
    .union([z.literal(''), z.url()])
    .default('')
    .transform((value) => value.replace(/\/+$/, '')),
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const result = WebEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Variables de entorno inválidas:\n${issues.join('\n')}`);
  }
  return result.data;
}
