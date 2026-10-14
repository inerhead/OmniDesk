import { describe, expect, it } from 'vitest';
import {
  attachmentContentPath,
  checkOutboundAttachment,
  normalizeMimeType,
  OUTBOUND_ATTACHMENT_ACCEPT,
} from './attachments';
import { MessageSchema } from './conversations';

const MB = 1024 * 1024;

describe('normalizeMimeType', () => {
  it('quita parámetros, pasa a minúsculas y aplica alias de navegadores', () => {
    expect(normalizeMimeType('Audio/OGG; codecs=opus')).toBe('audio/ogg');
    expect(normalizeMimeType('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeMimeType('image/jpg')).toBe('image/jpeg');
  });
});

describe('checkOutboundAttachment', () => {
  it('acepta un PDF con pie y devuelve DOCUMENT', () => {
    expect(
      checkOutboundAttachment({ mimeType: 'application/pdf', sizeBytes: 2 * MB }, 'Factura'),
    ).toEqual({ ok: true, kind: 'DOCUMENT', mimeType: 'application/pdf' });
  });

  it('acepta un .m4a declarado como audio/x-m4a sin pie', () => {
    expect(checkOutboundAttachment({ mimeType: 'audio/x-m4a', sizeBytes: MB }, '')).toEqual({
      ok: true,
      kind: 'AUDIO',
      mimeType: 'audio/mp4',
    });
  });

  it('rechaza tipos no admitidos, vacíos y demasiado grandes', () => {
    const check = (mimeType: string, sizeBytes: number) =>
      checkOutboundAttachment({ mimeType, sizeBytes }, '');
    expect(check('application/zip', MB)).toEqual({ ok: false, reason: 'UNSUPPORTED_TYPE' });
    expect(check('', MB)).toEqual({ ok: false, reason: 'UNSUPPORTED_TYPE' });
    expect(check('image/png', 0)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(check('image/png', 5 * MB + 1)).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(check('video/mp4', 16 * MB + 1)).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('rechaza pie en audios y pies de más de 1024 caracteres', () => {
    expect(checkOutboundAttachment({ mimeType: 'audio/mpeg', sizeBytes: MB }, 'hola')).toEqual({
      ok: false,
      reason: 'CAPTION_NOT_ALLOWED',
    });
    expect(
      checkOutboundAttachment({ mimeType: 'image/png', sizeBytes: MB }, 'x'.repeat(1025)),
    ).toEqual({ ok: false, reason: 'CAPTION_TOO_LONG' });
  });

  it('no admite stickers salientes', () => {
    expect(checkOutboundAttachment({ mimeType: 'image/webp', sizeBytes: 1000 }, '')).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    });
    expect(OUTBOUND_ATTACHMENT_ACCEPT).not.toContain('image/webp');
  });
});

describe('attachmentContentPath', () => {
  it('apunta al endpoint de contenido', () => {
    expect(attachmentContentPath('0199c0de-0000-7000-8000-000000000001')).toBe(
      '/api/v1/attachments/0199c0de-0000-7000-8000-000000000001/content',
    );
  });
});

describe('MessageSchema.attachment', () => {
  const base = {
    id: '0199c0de-0000-7000-8000-000000000001',
    sequence: 1,
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    text: '',
    status: 'RECEIVED',
    sender: null,
    failureReason: null,
    createdAt: '2026-10-13T10:00:00.000Z',
  };

  it('vale null si no viene', () => {
    expect(MessageSchema.parse(base).attachment).toBeNull();
  });

  it('acepta un adjunto', () => {
    const attachment = {
      id: '0199c0de-0000-7000-8000-000000000002',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: null,
      sizeBytes: 1234,
      voice: false,
      status: 'READY',
    };
    expect(MessageSchema.parse({ ...base, attachment }).attachment).toEqual(attachment);
  });
});
