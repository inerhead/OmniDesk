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

/** 32 bytes en base64 (`openssl rand -base64 32`): clave AES-256-GCM de los secretos de canal. */
const secretsKey = z
  .string()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === 32, 'Debe ser de 32 bytes en base64 (openssl rand -base64 32)');

const csvOfHosts = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );

/** Lista de emails separada por comas, en minúsculas y sin espacios. Vacía si no se define. */
const csvOfEmails = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.email()));

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default('v25.0'),
    API_PORT: z.coerce.number().int().positive().default(5001),
    /** Dueño de las tablas: migraciones y caminos de sistema (SPEC 12). */
    DATABASE_URL: z.url(),
    /** Rol de aplicación sin BYPASSRLS: todo lo que actúa en nombre de una empresa (SPEC 12). */
    DATABASE_APP_URL: z.url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: csvOfUrls.default(['http://localhost:8080', 'http://localhost:5173']),
    /** Habilita el tenant demo (seed + lectura sin login). Prohibido en producción. */
    DEMO_MODE: booleanString,
    /** Admins de plataforma (SPEC 18): aprueban, rechazan y suspenden empresas. */
    PLATFORM_ADMIN_EMAILS: csvOfEmails,
    /** API key del canal demo; se guarda hasheada. */
    DEMO_CHANNEL_API_KEY: z.string().min(24).optional(),
    /** Probabilidad (0 a 1) de que el proveedor simulado (canales `SIMULATED`) falle un envío. */
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
    /** Clave de cifrado de los secretos HMAC de los canales (distinta por entorno). Obligatoria en producción. */
    CHANNEL_SECRETS_KEY: z.preprocess((value) => value || undefined, secretsKey.optional()),
    /** Hosts a los que se admite un `webhookUrl` por `http://` o con IP privada (p. ej. "n8n"). */
    N8N_WEBHOOK_ALLOWED_HOSTS: csvOfHosts,
    /** Cookie de sesión solo por HTTPS. Obligatorio en producción. */
    SESSION_COOKIE_SECURE: booleanString,
    /** Dónde se guardan los adjuntos: `s3` (MinIO u otro S3) o `memory` (pruebas; se pierden al reiniciar). */
    ATTACHMENT_STORAGE_DRIVER: z.enum(['memory', 's3']).default('memory'),
    S3_ENDPOINT: z.preprocess((value) => value || undefined, z.url().optional()),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default('omnidesk-attachments'),
    S3_ACCESS_KEY_ID: z.preprocess((value) => value || undefined, z.string().min(3).optional()),
    S3_SECRET_ACCESS_KEY: z.preprocess((value) => value || undefined, z.string().min(8).optional()),
    /** Tope de un adjunto entrante: los mayores quedan FAILED sin descargarse. */
    ATTACHMENT_INBOUND_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),
    /** Claves Web Push. Las tres juntas habilitan el módulo; si faltan, no se encolan avisos. */
    /**
     * Token de `GET /api/v1/metrics` (SPEC 11), al menos 32 caracteres. Vacío = el endpoint no
     * existe (404).
     */
    METRICS_TOKEN: z.preprocess((value) => value || undefined, z.string().min(32).optional()),
    /** Con un evento del Outbox pendiente desde hace más de esto, `/health` dice `lagging`. */
    OUTBOX_LAG_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(60),
    VAPID_PUBLIC_KEY: z.preprocess((value) => value || undefined, z.string().min(1).optional()),
    VAPID_PRIVATE_KEY: z.preprocess((value) => value || undefined, z.string().min(1).optional()),
    VAPID_SUBJECT: z.preprocess(
      (value) => value || undefined,
      z
        .string()
        .regex(
          /^mailto:[^@\s]+@[^@\s]+$/,
          'Debe ser un mailto: (p. ej. mailto:soporte@gastromesa.com)',
        )
        .optional(),
    ),
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
      if (!env.CHANNEL_SECRETS_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['CHANNEL_SECRETS_KEY'],
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
    if (env.ATTACHMENT_STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Es obligatoria con ATTACHMENT_STORAGE_DRIVER=s3',
          });
        }
      }
    }
    const vapid = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT];
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT van juntas',
      });
    }
    if (env.NODE_ENV === 'production' && env.ATTACHMENT_STORAGE_DRIVER !== 's3') {
      ctx.addIssue({
        code: 'custom',
        path: ['ATTACHMENT_STORAGE_DRIVER'],
        message: 'Debe ser s3 con NODE_ENV=production',
      });
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
