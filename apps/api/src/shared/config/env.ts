import { z } from 'zod';

const csvOfUrls = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.url()).min(1));

/** Ruta base pública: vacía (raíz) o `/algo` sin barra final. */
const basePath = z
  .string()
  .regex(/^(\/[A-Za-z0-9._~-]+)*$/, 'Debe empezar por "/" y no terminar en "/" (p. ej. /omnidesk)');

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(5001),
    DATABASE_URL: z.url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: csvOfUrls.default(['http://localhost:8080', 'http://localhost:5173']),
    /** Habilita el tenant demo (seed + lectura sin login). Prohibido en producción. */
    DEMO_MODE: booleanString,
    /** API key del canal demo; se guarda hasheada. */
    DEMO_CHANNEL_API_KEY: z.string().min(24).optional(),
    /** Adaptador de mensajería saliente; hoy solo existe el simulado. */
    MESSAGING_PROVIDER: z.enum(['simulated']).default('simulated'),
    /** Probabilidad (0 a 1) de que el proveedor simulado falle un envío. */
    SIMULATED_PROVIDER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    /** Cliente OAuth de Google. Sin él, el login con Google no está disponible (obligatorio en producción). */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALLBACK_URL: z
      .url()
      .default('http://localhost:8080/omnidesk/api/v1/auth/google/callback'),
    /** Base de la web: enlaces de invitación y redirecciones tras el login. Incluye PUBLIC_BASE_PATH. */
    APP_URL: z.url().default('http://localhost:8080/omnidesk'),
    /** Subruta pública de la app (ruta de la cookie). El gateway la quita antes de llegar al API. */
    PUBLIC_BASE_PATH: basePath.default('/omnidesk'),
    /** Proxies delante del API (`trust proxy` de Express): 1 = Caddy, 2 = Nginx + Caddy. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    /** Versión desplegada (commit corto o etiqueta). Sin ella, la de package.json. */
    APP_VERSION: z.preprocess((value) => value || undefined, z.string().optional()),
    /** Cookie de sesión solo por HTTPS. Obligatorio en producción. */
    SESSION_COOKIE_SECURE: booleanString,
  })
  .superRefine((env, ctx) => {
    if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'Es obligatoria con GOOGLE_CLIENT_ID',
      });
    }
    if (new URL(env.APP_URL).pathname.replace(/\/$/, '') !== env.PUBLIC_BASE_PATH) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: `Su ruta debe ser PUBLIC_BASE_PATH (${env.PUBLIC_BASE_PATH || '/'})`,
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.GOOGLE_CLIENT_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['GOOGLE_CLIENT_ID'],
          message: 'Es obligatoria con NODE_ENV=production',
        });
      }
      if (!env.SESSION_COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_COOKIE_SECURE'],
          message: 'Debe ser true con NODE_ENV=production',
        });
      }
    }
    if (!env.DEMO_MODE) return;
    if (env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEMO_MODE'],
        message: 'DEMO_MODE=true no está permitido con NODE_ENV=production',
      });
    }
    if (!env.DEMO_CHANNEL_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEMO_CHANNEL_API_KEY'],
        message: 'Es obligatoria con DEMO_MODE=true',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Token de inyección para la configuración validada. */
export const ENV = Symbol('ENV');

export class InvalidEnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Variables de entorno inválidas:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidEnvError';
  }
}

/** Valida las variables de entorno. Lanza `InvalidEnvError` nombrando cada variable inválida. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
