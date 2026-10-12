import { describe, expect, it } from 'vitest';
import { InvalidEnvError, parseEnv } from './env';

const valid = { DATABASE_URL: 'postgresql://omnidesk:omnidesk@postgres:5432/omnidesk' };

describe('parseEnv', () => {
  it('aplica los valores por defecto con un entorno mínimo válido', () => {
    const env = parseEnv(valid);

    expect(env.API_PORT).toBe(5001);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8080', 'http://localhost:5173']);
  });

  it('separa CORS_ORIGINS por comas', () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: 'https://app.example.com, http://localhost:8080',
    });

    expect(env.CORS_ORIGINS).toEqual(['https://app.example.com', 'http://localhost:8080']);
  });

  it('falla nombrando DATABASE_URL cuando falta', () => {
    expect(() => parseEnv({})).toThrowError(InvalidEnvError);
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('falla nombrando CORS_ORIGINS cuando contiene algo que no es URL', () => {
    expect(() => parseEnv({ ...valid, CORS_ORIGINS: 'no-es-url' })).toThrowError(/CORS_ORIGINS/);
  });
});

describe('parseEnv — modo demo', () => {
  const key = 'dev-demo-channel-key-change-me';

  it('DEMO_MODE es false por defecto', () => {
    expect(parseEnv(valid).DEMO_MODE).toBe(false);
  });

  it('acepta DEMO_MODE=true con una key válida', () => {
    const env = parseEnv({ ...valid, DEMO_MODE: 'true', DEMO_CHANNEL_API_KEY: key });

    expect(env.DEMO_MODE).toBe(true);
    expect(env.DEMO_CHANNEL_API_KEY).toBe(key);
  });

  it('exige DEMO_CHANNEL_API_KEY con DEMO_MODE=true', () => {
    expect(() => parseEnv({ ...valid, DEMO_MODE: 'true' })).toThrowError(/DEMO_CHANNEL_API_KEY/);
  });

  it('rechaza una key de menos de 24 caracteres', () => {
    expect(() =>
      parseEnv({ ...valid, DEMO_MODE: 'true', DEMO_CHANNEL_API_KEY: 'corta' }),
    ).toThrowError(/DEMO_CHANNEL_API_KEY/);
  });

  it('rechaza DEMO_MODE=true en producción nombrando DEMO_MODE', () => {
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: 'production', DEMO_MODE: 'true', DEMO_CHANNEL_API_KEY: key }),
    ).toThrowError(/DEMO_MODE: DEMO_MODE=true no está permitido/);
  });
});

describe('parseEnv — mensajería saliente', () => {
  it('usa el proveedor simulado y una tasa de fallo 0 por defecto', () => {
    const env = parseEnv(valid);

    expect(env.MESSAGING_PROVIDER).toBe('simulated');
    expect(env.SIMULATED_PROVIDER_FAILURE_RATE).toBe(0);
  });

  it('convierte la tasa de fallo a número', () => {
    expect(parseEnv({ ...valid, SIMULATED_PROVIDER_FAILURE_RATE: '0.25' })).toMatchObject({
      SIMULATED_PROVIDER_FAILURE_RATE: 0.25,
    });
  });

  it.each(['-0.1', '1.5', 'mucho'])('rechaza la tasa de fallo %s', (rate) => {
    expect(() => parseEnv({ ...valid, SIMULATED_PROVIDER_FAILURE_RATE: rate })).toThrowError(
      /SIMULATED_PROVIDER_FAILURE_RATE/,
    );
  });

  it('rechaza un proveedor que no sea simulated', () => {
    expect(() => parseEnv({ ...valid, MESSAGING_PROVIDER: 'n8n' })).toThrowError(
      /MESSAGING_PROVIDER/,
    );
  });
});
