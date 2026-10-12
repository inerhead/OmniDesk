import { z } from 'zod';

/**
 * Variables de entorno de la web (se resuelven en tiempo de build).
 * Lo comparten `vite.config.ts` (falla el build) y `env.ts` (falla el arranque).
 */
export const WebEnvSchema = z.object({
  // Subruta donde se sirve la app (`base` de Vite). Vacía = raíz; si no, "/algo" sin barra final.
  BASE_PATH: z
    .string()
    .regex(
      /^(\/[A-Za-z0-9._~-]+)*$/,
      'Debe empezar por "/" y no terminar en "/" (p. ej. /omnidesk)',
    )
    .default('/omnidesk'),
  // Vacía = mismo origen (`<BASE_PATH>/api/...` detrás del gateway). Si no, URL absoluta del API, sin barra final.
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

/** `BASE_URL` de Vite ("/omnidesk/") como subruta sin barra final ("/omnidesk"; "" en la raíz). */
export function basePathFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** Prefijo de las rutas `/api/...`: `VITE_API_URL` o, en mismo origen, la subruta de la app. */
export function apiBaseFor(viteApiUrl: string, basePath: string): string {
  return viteApiUrl || basePath;
}

/** Destino de Socket.IO: en mismo origen, el `path` lleva la subruta que quita el gateway. */
export function realtimeTargetFor(
  viteApiUrl: string,
  basePath: string,
  origin: string,
  realtimePath: string,
): { url: string; path: string } {
  if (viteApiUrl) return { url: viteApiUrl, path: realtimePath };
  return { url: origin, path: `${basePath}${realtimePath}` };
}
