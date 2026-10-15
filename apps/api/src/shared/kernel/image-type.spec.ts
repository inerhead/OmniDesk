import { describe, expect, it } from 'vitest';
import { detectImageMimeType } from './image-type';

const bytes = (...values: Array<number | string>) =>
  Buffer.concat(
    values.map((value) =>
      typeof value === 'string' ? Buffer.from(value, 'ascii') : Buffer.from([value]),
    ),
  );

describe('detectImageMimeType', () => {
  it('reconoce JPEG por FF D8 FF', () => {
    expect(detectImageMimeType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg');
  });

  it('reconoce WebP por RIFF….WEBP', () => {
    expect(detectImageMimeType(bytes('RIFF', 0x24, 0, 0, 0, 'WEBP', 'VP8 '))).toBe('image/webp');
  });

  it('rechaza PNG, GIF, otro RIFF y archivos vacíos o cortos', () => {
    expect(detectImageMimeType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull();
    expect(detectImageMimeType(bytes('GIF89a'))).toBeNull();
    expect(detectImageMimeType(bytes('RIFF', 0x24, 0, 0, 0, 'WAVE'))).toBeNull();
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectImageMimeType(bytes(0xff, 0xd8))).toBeNull();
  });
});
