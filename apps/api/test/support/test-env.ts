import { parseEnv, type Env } from '../../src/shared/config/env';

export const E2E_DEMO_KEY = 'e2e-demo-channel-key-0123456789';
/** Clave fija de las pruebas para cifrar los secretos HMAC de los canales. */
export const E2E_CHANNEL_SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');

function withE2eSuffix(variable: 'DATABASE_URL' | 'DATABASE_APP_URL'): string {
  const value = process.env[variable];
  if (!value) throw new Error(`Las pruebas e2e requieren ${variable}`);
  const url = new URL(value);
  url.pathname = `${url.pathname}_e2e`;
  return url.toString();
}

/** Base de datos de las pruebas e2e: la de DATABASE_URL con sufijo `_e2e`, para no tocar los datos de desarrollo. */
export function testDatabaseUrl(): string {
  return withE2eSuffix('DATABASE_URL');
}

/** La misma base `_e2e`, con el rol de aplicación sin BYPASSRLS (SPEC 12). */
export function testAppDatabaseUrl(): string {
  return withE2eSuffix('DATABASE_APP_URL');
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    ...process.env,
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_APP_URL: testAppDatabaseUrl(),
    LOG_LEVEL: 'warn',
    CORS_ORIGINS: 'http://localhost:8080,http://localhost:5173',
    DEMO_MODE: 'true',
    DEMO_CHANNEL_API_KEY: E2E_DEMO_KEY,
    PUBLIC_BASE_PATH: '/omnidesk',
    CHANNEL_SECRETS_KEY: E2E_CHANNEL_SECRETS_KEY,
    APP_URL: 'http://localhost:8080/omnidesk',
    ATTACHMENT_STORAGE_DRIVER: 'memory',
    ...overrides,
  });
}
