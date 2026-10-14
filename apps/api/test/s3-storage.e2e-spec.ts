import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { S3AttachmentStorage } from '../src/modules/attachments/infrastructure/s3-attachment-storage';
import { testEnv } from './support/test-env';

describe.runIf(process.env.S3_E2E_ENDPOINT)('S3AttachmentStorage contra MinIO (e2e)', () => {
  it('crea el bucket, guarda, lee por rango y borra', async () => {
    const storage = new S3AttachmentStorage(
      testEnv({
        ATTACHMENT_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: process.env.S3_E2E_ENDPOINT!,
        S3_BUCKET: 'omnidesk-e2e',
        S3_ACCESS_KEY_ID: process.env.MINIO_ROOT_USER ?? 'omnidesk',
        S3_SECRET_ACCESS_KEY: process.env.MINIO_ROOT_PASSWORD ?? 'omnidesk-dev-secret',
      }),
    );
    await storage.ensureBucket();
    const key = `e2e/${randomUUID()}`;
    await storage.put(key, Buffer.from('hola mundo'), {
      contentType: 'text/plain',
      contentLength: 10,
    });

    expect((await buffer((await storage.get(key, { start: 5, end: 9 })).body)).toString()).toBe(
      'mundo',
    );
    await storage.delete(key);
  });
});
