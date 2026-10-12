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
