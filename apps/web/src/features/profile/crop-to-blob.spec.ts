import { describe, expect, it, vi } from 'vitest';
import { checkAvatarSource, encodeAvatar } from './crop-to-blob';

describe('checkAvatarSource', () => {
  it('acepta JPEG, PNG y WebP de hasta 10 MB', () => {
    expect(checkAvatarSource({ type: 'image/jpeg', size: 10 * 1024 * 1024 })).toBe('ok');
    expect(checkAvatarSource({ type: 'image/png', size: 1 })).toBe('ok');
    expect(checkAvatarSource({ type: 'image/webp', size: 1 })).toBe('ok');
  });

  it('rechaza otros tipos y más de 10 MB', () => {
    expect(checkAvatarSource({ type: 'image/gif', size: 1 })).toBe('unsupported');
    expect(checkAvatarSource({ type: 'application/pdf', size: 1 })).toBe('unsupported');
    expect(checkAvatarSource({ type: 'image/heic', size: 1 })).toBe('unsupported');
    expect(checkAvatarSource({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe('too-large');
  });
});

describe('encodeAvatar', () => {
  it('usa WebP si el navegador lo exporta', async () => {
    const toBlob = vi.fn(async (type: string) => new Blob(['x'], { type }));
    expect((await encodeAvatar(toBlob)).type).toBe('image/webp');
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledWith('image/webp', 0.85);
  });

  it('cae a JPEG si devuelve otro tipo (Safari da PNG)', async () => {
    const toBlob = vi.fn(async (type: string) =>
      type === 'image/webp' ? new Blob(['x'], { type: 'image/png' }) : new Blob(['x'], { type }),
    );
    expect((await encodeAvatar(toBlob)).type).toBe('image/jpeg');
    expect(toBlob).toHaveBeenLastCalledWith('image/jpeg', 0.85);
  });

  it('falla si no exporta nada', async () => {
    await expect(encodeAvatar(async () => null)).rejects.toThrow();
  });
});
