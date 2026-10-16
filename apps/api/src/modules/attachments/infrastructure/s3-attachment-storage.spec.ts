import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NotFound,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../../shared/config/env';
import { S3AttachmentStorage } from './s3-attachment-storage';

const env = parseEnv({
  DATABASE_URL: 'postgresql://omnidesk:omnidesk@postgres:5432/omnidesk',
  DATABASE_APP_URL: 'postgresql://omnidesk_app_login:app@postgres:5432/omnidesk',
  ATTACHMENT_STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY_ID: 'omnidesk',
  S3_SECRET_ACCESS_KEY: 'omnidesk-dev-secret',
});

const metadata = (httpStatusCode: number) => ({
  $metadata: { httpStatusCode },
  $fault: 'client' as const,
});

function mockSend(responses: { head: unknown; create?: unknown }) {
  return vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    const outcome = command instanceof HeadBucketCommand ? responses.head : responses.create;
    if (outcome instanceof Error) throw outcome;
    return {};
  });
}

const createCalls = (send: ReturnType<typeof mockSend>) =>
  send.mock.calls.filter(([command]) => command instanceof CreateBucketCommand).length;

describe('S3AttachmentStorage.ensureBucket', () => {
  afterEach(() => vi.restoreAllMocks());

  it('crea el bucket si HeadBucket responde 404', async () => {
    const send = mockSend({ head: new NotFound({ message: 'NotFound', ...metadata(404) }) });

    await new S3AttachmentStorage(env).ensureBucket();

    expect(createCalls(send)).toBe(1);
  });

  it('no crea nada si el bucket ya existe', async () => {
    const send = mockSend({ head: undefined });

    await new S3AttachmentStorage(env).ensureBucket();

    expect(createCalls(send)).toBe(0);
  });

  it('propaga un 403 sin crear el bucket', async () => {
    const forbidden = new S3ServiceException({
      name: 'Forbidden',
      message: 'Forbidden',
      ...metadata(403),
    });
    const send = mockSend({ head: forbidden });

    await expect(new S3AttachmentStorage(env).ensureBucket()).rejects.toBe(forbidden);
    expect(createCalls(send)).toBe(0);
  });

  it('tolera que otra instancia lo haya creado a la vez', async () => {
    mockSend({
      head: new NotFound({ message: 'NotFound', ...metadata(404) }),
      create: new BucketAlreadyOwnedByYou({ message: 'BucketAlreadyOwnedByYou', ...metadata(409) }),
    });

    await expect(new S3AttachmentStorage(env).ensureBucket()).resolves.toBeUndefined();
  });
});

describe('S3AttachmentStorage.deletePrefix', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Bucket falso: `ListObjectsV2` devuelve hasta 1000 claves; `DeleteObjects` las quita. */
  function fakeBucket(keys: string[], deleteErrors: unknown[] = []) {
    const stored = new Set(keys);
    const deletes: string[][] = [];
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? '';
        const page = [...stored].filter((key) => key.startsWith(prefix)).slice(0, 1000);
        return { Contents: page.map((Key) => ({ Key })) };
      }
      if (command instanceof DeleteObjectsCommand) {
        const batch = (command.input.Delete?.Objects ?? []).map((object) => object.Key!);
        deletes.push(batch);
        if (deleteErrors.length > 0) return { Errors: deleteErrors };
        for (const key of batch) stored.delete(key);
        return {};
      }
      throw new Error('comando no esperado');
    });
    return { stored, deletes };
  }

  it('borra en lotes de 1000 hasta vaciar el prefijo y no toca el resto', async () => {
    const keys = Array.from({ length: 2500 }, (_, index) => `tenants/a/attachments/${index}`);
    const bucket = fakeBucket([...keys, 'tenants/ab/logo-1', 'users/u1/avatar-1']);

    expect(await new S3AttachmentStorage(env).deletePrefix('tenants/a/')).toBe(2500);

    expect(bucket.deletes.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect([...bucket.stored]).toEqual(['tenants/ab/logo-1', 'users/u1/avatar-1']);
  });

  it('con el prefijo vacío devuelve 0 sin borrar nada', async () => {
    const bucket = fakeBucket(['users/u1/avatar-1']);

    expect(await new S3AttachmentStorage(env).deletePrefix('tenants/a/')).toBe(0);
    expect(bucket.deletes).toEqual([]);
  });

  it('falla si S3 informa objetos sin borrar', async () => {
    fakeBucket(['tenants/a/logo-1'], [{ Key: 'tenants/a/logo-1', Code: 'AccessDenied' }]);

    await expect(new S3AttachmentStorage(env).deletePrefix('tenants/a/')).rejects.toThrow(
      /AccessDenied/,
    );
  });
});
