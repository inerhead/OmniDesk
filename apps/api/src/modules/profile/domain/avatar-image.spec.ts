import { describe, expect, it } from 'vitest';
import { avatarStorageKey, detectAvatarMimeType } from './avatar-image';

const bytes = (...values: Array<number | string>) =>
  Buffer.concat(
    values.map((value) =>
      typeof value === 'string' ? Buffer.from(value, 'ascii') : Buffer.from([value]),
    ),
  );

describe('detectAvatarMimeType', () => {
  it('reconoce JPEG por FF D8 FF', () => {
    expect(detectAvatarMimeType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg');
  });

  it('reconoce WebP por RIFF….WEBP', () => {
    expect(detectAvatarMimeType(bytes('RIFF', 0x24, 0, 0, 0, 'WEBP', 'VP8 '))).toBe('image/webp');
  });

  it('rechaza PNG, GIF, otro RIFF y archivos vacíos o cortos', () => {
    expect(detectAvatarMimeType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull();
    expect(detectAvatarMimeType(bytes('GIF89a'))).toBeNull();
    expect(detectAvatarMimeType(bytes('RIFF', 0x24, 0, 0, 0, 'WAVE'))).toBeNull();
    expect(detectAvatarMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectAvatarMimeType(bytes(0xff, 0xd8))).toBeNull();
  });
});

describe('avatarStorageKey', () => {
  it('vive bajo users/, fuera de tenants/', () => {
    expect(avatarStorageKey('u1', 'abc')).toBe('users/u1/avatar-abc');
  });
});
