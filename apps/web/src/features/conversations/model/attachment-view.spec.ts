import type { Attachment } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { formatBytes, toAttachmentView } from './attachment-view';

const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: '0199c0de-0000-7000-8000-000000000001',
  kind: 'IMAGE',
  mimeType: 'image/jpeg',
  fileName: null,
  sizeBytes: 1536,
  voice: false,
  status: 'READY',
  ...overrides,
});

describe('toAttachmentView', () => {
  it('arma la URL bajo la base del API y nombra el tipo', () => {
    expect(toAttachmentView(attachment(), '/omnidesk')).toEqual({
      variant: 'image',
      state: 'ready',
      src: '/omnidesk/api/v1/attachments/0199c0de-0000-7000-8000-000000000001/content',
      label: 'Foto',
      fileName: null,
      sizeLabel: '2 KB',
    });
  });

  it('distingue nota de voz, pendiente y fallido', () => {
    expect(toAttachmentView(attachment({ kind: 'AUDIO', voice: true }), '').label).toBe(
      'Nota de voz',
    );
    expect(toAttachmentView(attachment({ status: 'PENDING', sizeBytes: null }), '')).toMatchObject({
      state: 'pending',
      sizeLabel: null,
    });
    expect(toAttachmentView(attachment({ status: 'FAILED' }), '').state).toBe('failed');
  });
});

describe('formatBytes', () => {
  it('usa B, KB y MB con coma decimal', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(20_480)).toBe('20 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
