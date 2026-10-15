import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../shared/config/env';
import { MemoryAttachmentStorage } from '../attachments/infrastructure/memory-attachment-storage';
import type { SendMessageRequest } from '../messaging/application/ports/messaging-provider.port';
import { WhatsAppCloudProvider } from './whatsapp-cloud-provider';
import type { WhatsAppSettings } from './whatsapp-settings';

describe('WhatsAppCloudProvider con adjunto', () => {
  const fetchMock = vi.fn();
  let storage: MemoryAttachmentStorage;
  let provider: WhatsAppCloudProvider;
  const request = (overrides: Partial<SendMessageRequest> = {}): SendMessageRequest => ({
    tenantId: 't1',
    channel: { id: 'c1' } as SendMessageRequest['channel'],
    conversationId: 'k1',
    messageId: '0199c0de-0000-7000-8000-0000000000aa',
    to: '+573001110001',
    text: 'Te paso la cotización',
    attachment: {
      kind: 'DOCUMENT',
      mimeType: 'application/pdf',
      fileName: 'cotización.pdf',
      storageKey: 'k/pdf',
    },
    ...overrides,
  });

  beforeEach(async () => {
    storage = new MemoryAttachmentStorage();
    await storage.put('k/pdf', Buffer.from('%PDF'), {
      contentType: 'application/pdf',
      contentLength: 4,
    });
    const settings = {
      find: async () => ({ externalId: '1322469280958506', whatsappAccessTokenEnc: Buffer.from('e') }),
    } as unknown as WhatsAppSettings;
    const cipher = { encrypt: () => Buffer.alloc(0), decrypt: () => 'token-meta' };
    provider = new WhatsAppCloudProvider(
      settings,
      cipher,
      parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', DATABASE_APP_URL: 'postgresql://a:p@h:5432/d' }),
      storage,
    );
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'media-up-1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.OUT' }] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sube a /media y envía el documento con media id, pie y nombre', async () => {
    await expect(provider.send(request())).resolves.toEqual({ providerMessageId: 'wamid.OUT' });

    const [uploadUrl, upload] = fetchMock.mock.calls[0]!;
    expect(String(uploadUrl)).toMatch(/\/1322469280958506\/media$/);
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get('type')).toBe('application/pdf');
    const [, send] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(send.body)).toMatchObject({
      type: 'document',
      document: { id: 'media-up-1', caption: 'Te paso la cotización', filename: 'cotización.pdf' },
      biz_opaque_callback_data: '0199c0de-0000-7000-8000-0000000000aa',
    });
  });

  it('un audio no lleva caption', async () => {
    await storage.put('k/mp3', Buffer.from('ID3'), { contentType: 'audio/mpeg', contentLength: 3 });
    await provider.send(
      request({
        text: '',
        attachment: { kind: 'AUDIO', mimeType: 'audio/mpeg', fileName: 'a.mp3', storageKey: 'k/mp3' },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      type: 'audio',
      audio: { id: 'media-up-1' },
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).audio).not.toHaveProperty('caption');
  });

  it('un fallo de /media lanza para que el Outbox reintente', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(provider.send(request())).rejects.toThrow(/media HTTP 500/);
  });
});
