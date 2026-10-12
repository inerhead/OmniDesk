import { parseEnv, type Env } from '../../src/shared/config/env';

export const E2E_DEMO_KEY = 'e2e-demo-channel-key-0123456789';

/** Base de datos de las pruebas e2e: la de DATABASE_URL con sufijo `_e2e`, para no tocar los datos de desarrollo. */
export function testDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) throw new Error('Las pruebas e2e requieren DATABASE_URL');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname}_e2e`;
  return url.toString();
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    ...process.env,
    DATABASE_URL: testDatabaseUrl(),
    LOG_LEVEL: 'warn',
    CORS_ORIGINS: 'http://localhost:8080,http://localhost:5173',
    DEMO_MODE: 'true',
    DEMO_CHANNEL_API_KEY: E2E_DEMO_KEY,
    PUBLIC_BASE_PATH: '/omnidesk',
    APP_URL: 'http://localhost:8080/omnidesk',
    ...overrides,
  });
}
