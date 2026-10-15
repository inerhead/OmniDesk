import { describe, expect, it } from 'vitest';
import { InvalidEnvError, parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://omnidesk:omnidesk@postgres:5432/omnidesk',
  DATABASE_APP_URL: 'postgresql://omnidesk_app_login:app@postgres:5432/omnidesk',
};

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

  it('falla nombrando DATABASE_APP_URL cuando falta', () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrowError(/DATABASE_APP_URL/);
  });

  it('METRICS_TOKEN vacío es ausente y uno corto se rechaza', () => {
    expect(parseEnv({ ...valid, METRICS_TOKEN: '' }).METRICS_TOKEN).toBeUndefined();
    expect(() => parseEnv({ ...valid, METRICS_TOKEN: 'corto' })).toThrowError(/METRICS_TOKEN/);
    expect(parseEnv({ ...valid, METRICS_TOKEN: 'x'.repeat(32) }).METRICS_TOKEN).toBe(
      'x'.repeat(32),
    );
  });

  it('PLATFORM_ADMIN_EMAILS es una lista vacía por defecto', () => {
    expect(parseEnv(valid).PLATFORM_ADMIN_EMAILS).toEqual([]);
    expect(parseEnv({ ...valid, PLATFORM_ADMIN_EMAILS: '' }).PLATFORM_ADMIN_EMAILS).toEqual([]);
  });

  it('normaliza PLATFORM_ADMIN_EMAILS a minúsculas y sin espacios', () => {
    const env = parseEnv({ ...valid, PLATFORM_ADMIN_EMAILS: ' Ana@Example.com ,, b@example.com' });

    expect(env.PLATFORM_ADMIN_EMAILS).toEqual(['ana@example.com', 'b@example.com']);
  });

  it('falla nombrando PLATFORM_ADMIN_EMAILS cuando contiene algo que no es email', () => {
    expect(() => parseEnv({ ...valid, PLATFORM_ADMIN_EMAILS: 'no-es-email' })).toThrowError(
      /PLATFORM_ADMIN_EMAILS/,
    );
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
  it('usa una tasa de fallo 0 por defecto', () => {
    expect(parseEnv(valid).SIMULATED_PROVIDER_FAILURE_RATE).toBe(0);
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
});

describe('parseEnv — canales', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('CHANNEL_SECRETS_KEY es opcional fuera de producción y se decodifica a 32 bytes', () => {
    expect(parseEnv(valid).CHANNEL_SECRETS_KEY).toBeUndefined();
    expect(parseEnv({ ...valid, CHANNEL_SECRETS_KEY: '' }).CHANNEL_SECRETS_KEY).toBeUndefined();
    expect(parseEnv({ ...valid, CHANNEL_SECRETS_KEY: key }).CHANNEL_SECRETS_KEY).toEqual(
      Buffer.alloc(32, 7),
    );
  });

  it('rechaza una clave que no sea de 32 bytes', () => {
    expect(() =>
      parseEnv({ ...valid, CHANNEL_SECRETS_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrowError(/CHANNEL_SECRETS_KEY/);
  });

  it('es obligatoria en producción', () => {
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        SESSION_COOKIE_SECURE: 'true',
      }),
    ).toThrowError(/CHANNEL_SECRETS_KEY/);
  });

  it('separa N8N_WEBHOOK_ALLOWED_HOSTS por comas, en minúsculas', () => {
    expect(parseEnv(valid).N8N_WEBHOOK_ALLOWED_HOSTS).toEqual([]);
    expect(
      parseEnv({ ...valid, N8N_WEBHOOK_ALLOWED_HOSTS: 'n8n, N8N.gastromesa.com,' })
        .N8N_WEBHOOK_ALLOWED_HOSTS,
    ).toEqual(['n8n', 'n8n.gastromesa.com']);
  });
});

describe('parseEnv — identidad', () => {
  const production = { ...valid, NODE_ENV: 'production' };

  it('usa las URLs locales por defecto y la cookie sin Secure', () => {
    const env = parseEnv(valid);

    expect(env.APP_URL).toBe('http://localhost:8080/omnidesk');
    expect(env.GOOGLE_CALLBACK_URL).toBe(
      'http://localhost:8080/omnidesk/api/v1/auth/google/callback',
    );
    expect(env.SESSION_COOKIE_SECURE).toBe(false);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('exige GOOGLE_CLIENT_SECRET si hay GOOGLE_CLIENT_ID', () => {
    expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_ID: 'id' })).toThrowError(
      /GOOGLE_CLIENT_SECRET/,
    );
  });

  it('en producción exige el cliente de Google y la cookie Secure', () => {
    expect(() => parseEnv(production)).toThrowError(/GOOGLE_CLIENT_ID/);
    expect(() =>
      parseEnv({ ...production, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toThrowError(/SESSION_COOKIE_SECURE/);
    expect(
      parseEnv({
        ...production,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        SESSION_COOKIE_SECURE: 'true',
        CHANNEL_SECRETS_KEY: Buffer.alloc(32).toString('base64'),
        ATTACHMENT_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://minio:9000',
        S3_ACCESS_KEY_ID: 'omnidesk',
        S3_SECRET_ACCESS_KEY: 'omnidesk-dev-secret',
      }).SESSION_COOKIE_SECURE,
    ).toBe(true);
  });
});

describe('parseEnv — subruta y proxy', () => {
  it('usa /omnidesk, un proxy y sin versión explícita por defecto', () => {
    const env = parseEnv(valid);

    expect(env.PUBLIC_BASE_PATH).toBe('/omnidesk');
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.APP_VERSION).toBeUndefined();
  });

  it('acepta la raíz con PUBLIC_BASE_PATH vacía', () => {
    const env = parseEnv({ ...valid, PUBLIC_BASE_PATH: '', APP_URL: 'http://localhost:8080' });

    expect(env.PUBLIC_BASE_PATH).toBe('');
  });

  it.each(['omnidesk', '/omnidesk/', '/', '/a b'])('rechaza PUBLIC_BASE_PATH=%s', (path) => {
    expect(() => parseEnv({ ...valid, PUBLIC_BASE_PATH: path })).toThrowError(/PUBLIC_BASE_PATH/);
  });

  it('exige que APP_URL termine en PUBLIC_BASE_PATH', () => {
    expect(() => parseEnv({ ...valid, APP_URL: 'https://gastromesa.com' })).toThrowError(/APP_URL/);
    expect(parseEnv({ ...valid, APP_URL: 'https://gastromesa.com/omnidesk/' }).APP_URL).toBe(
      'https://gastromesa.com/omnidesk/',
    );
  });

  it('convierte TRUST_PROXY a número y trata APP_VERSION vacía como ausente', () => {
    const env = parseEnv({ ...valid, TRUST_PROXY: '2', APP_VERSION: '' });

    expect(env.TRUST_PROXY).toBe(2);
    expect(env.APP_VERSION).toBeUndefined();
    expect(parseEnv({ ...valid, APP_VERSION: 'v0.1.0' }).APP_VERSION).toBe('v0.1.0');
  });

  it('rechaza un TRUST_PROXY negativo', () => {
    expect(() => parseEnv({ ...valid, TRUST_PROXY: '-1' })).toThrowError(/TRUST_PROXY/);
  });
});

describe('parseEnv — adjuntos', () => {
  const s3 = {
    ATTACHMENT_STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY_ID: 'omnidesk',
    S3_SECRET_ACCESS_KEY: 'omnidesk-dev-secret',
  };

  it('usa memoria y 25 MB por defecto', () => {
    const env = parseEnv(valid);
    expect(env.ATTACHMENT_STORAGE_DRIVER).toBe('memory');
    expect(env.ATTACHMENT_INBOUND_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(env.S3_BUCKET).toBe('omnidesk-attachments');
  });

  it('con s3 exige endpoint y credenciales', () => {
    expect(() => parseEnv({ ...valid, ATTACHMENT_STORAGE_DRIVER: 's3' })).toThrowError(
      /S3_ENDPOINT/,
    );
    expect(parseEnv({ ...valid, ...s3 }).S3_ENDPOINT).toBe('http://minio:9000');
  });

  it('en producción exige s3', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      CHANNEL_SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
      SESSION_COOKIE_SECURE: 'true',
    };
    expect(() => parseEnv(production)).toThrowError(/ATTACHMENT_STORAGE_DRIVER/);
    expect(() => parseEnv({ ...production, ...s3 })).not.toThrow();
  });
});

describe('parseEnv — Web Push', () => {
  it('sin claves deja el módulo apagado y exige las tres juntas', () => {
    expect(parseEnv(valid).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(() => parseEnv({ ...valid, VAPID_PUBLIC_KEY: 'public' })).toThrowError(
      /VAPID_PUBLIC_KEY/,
    );
    const env = parseEnv({
      ...valid,
      VAPID_PUBLIC_KEY: 'public',
      VAPID_PRIVATE_KEY: 'private',
      VAPID_SUBJECT: 'mailto:soporte@gastromesa.com',
    });
    expect(env.VAPID_SUBJECT).toBe('mailto:soporte@gastromesa.com');
  });
});
