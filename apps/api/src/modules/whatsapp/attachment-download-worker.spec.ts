import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../shared/config/env';
import { attachmentStorageKey } from '../attachments/application/ports/attachment-storage';
import { PermanentDownloadError } from '../attachments/domain/attachment-errors';
import { MemoryAttachmentStorage } from '../attachments/infrastructure/memory-attachment-storage';
import { InMemoryAttachments } from '../attachments/testing/in-memory';
import { InMemoryOutbox } from '../conversations/testing/in-memory';
import { AttachmentDownloadWorker, matchesSha256 } from './attachment-download-worker';
import type { WhatsAppSettings } from './whatsapp-settings';

const tenantId = '0199c0de-0000-7000-8000-0000000000a1';
const channelId = '0199c0de-0000-7000-8000-0000000000c1';
const attachmentId = '0199c0de-0000-7000-8000-0000000000f1';
const bytes = Buffer.from('contenido-de-la-foto');
const b64 = createHash('sha256').update(bytes).digest('base64');

describe('AttachmentDownloadWorker', () => {
  let attachments: InMemoryAttachments;
  let storage: MemoryAttachmentStorage;
  let outbox: InMemoryOutbox;
  let worker: AttachmentDownloadWorker;
  const fetchMock = vi.fn();

  beforeEach(() => {
    attachments = new InMemoryAttachments();
    storage = new MemoryAttachmentStorage();
    outbox = new InMemoryOutbox();
    attachments.add({
      id: attachmentId,
      tenantId,
      conversationId: '0199c0de-0000-7000-8000-0000000000b1',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: null,
      sizeBytes: null,
      status: 'PENDING',
      storageKey: null,
      providerMediaId: 'media-1',
      sha256: b64,
    });
    const settings = {
      find: async () => ({ id: channelId, whatsappAccessTokenEnc: Buffer.from('enc') }),
    } as unknown as WhatsAppSettings;
    const cipher = { encrypt: () => Buffer.alloc(0), decrypt: () => 'token-meta' };
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', ATTACHMENT_INBOUND_MAX_BYTES: '100' });
    worker = new AttachmentDownloadWorker(settings, cipher, env, attachments, storage, outbox);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const graph = (fileSize = bytes.length, body: Buffer = bytes) => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', sha256: b64, file_size: fileSize }))
      .mockResolvedValueOnce(new Response(new Uint8Array(body)));
  };

  it('descarga con el Bearer, guarda en el bucket, marca READY y avisa a la web', async () => {
    graph();
    await worker.process(tenantId, { attachmentId, channelId });

    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/media-1$/);
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe('Bearer token-meta');
    const row = attachments.rows.get(attachmentId)!;
    expect(row).toMatchObject({ status: 'READY', sizeBytes: bytes.length });
    expect(await buffer((await storage.get(row.storageKey!)).body)).toEqual(bytes);
    expect(outbox.events).toMatchObject([{ type: 'conversation.changed', payload: { reason: 'message' } }]);
  });

  it('lanza un error reintentable si el sha256 no coincide y no deja el objeto', async () => {
    // Mismo tamaño (20 bytes) y contenido distinto.
    graph(bytes.length, Buffer.from('contenido-distinto!!'));
    const error = await worker.process(tenantId, { attachmentId, channelId }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentDownloadError);
    expect((error as Error).message).toMatch(/sha256/);
    expect(attachments.rows.get(attachmentId)!.status).toBe('PENDING');
    await expect(storage.get(attachmentStorageKey(tenantId, attachmentId))).rejects.toThrow(/no existe/);
  });

  it('un archivo mayor que el tope es un error permanente', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: 'https://x', file_size: 101 }));
    await expect(worker.process(tenantId, { attachmentId, channelId })).rejects.toBeInstanceOf(PermanentDownloadError);
  });

  it('fail marca FAILED con el motivo y avisa a la web', async () => {
    await worker.fail(tenantId, { attachmentId, channelId }, 'TOO_LARGE');
    expect(attachments.rows.get(attachmentId)).toMatchObject({ status: 'FAILED', failureReason: 'TOO_LARGE' });
    expect(outbox.events).toHaveLength(1);
  });

  it('acepta el sha256 en base64 o en hex', () => {
    const digest = createHash('sha256').update(bytes).digest();
    expect(matchesSha256(digest, b64)).toBe(true);
    expect(matchesSha256(digest, digest.toString('hex').toUpperCase())).toBe(true);
    expect(matchesSha256(digest, 'otro')).toBe(false);
  });
});
