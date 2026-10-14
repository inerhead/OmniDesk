import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  NotFound,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../../shared/config/env';
import { S3AttachmentStorage } from './s3-attachment-storage';

const env = parseEnv({
  DATABASE_URL: 'postgresql://omnidesk:omnidesk@postgres:5432/omnidesk',
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
