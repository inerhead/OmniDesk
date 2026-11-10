import { describe, expect, it, vi } from 'vitest';
import { IMAGE_SOURCE_MAX_LABEL, checkImageSource, encodeImage } from './crop-to-blob';

describe('checkImageSource', () => {
  it('acepta JPEG, PNG y WebP de hasta 2 MB', () => {
    expect(checkImageSource({ type: 'image/jpeg', size: 2 * 1024 * 1024 })).toBe('ok');
    expect(checkImageSource({ type: 'image/png', size: 1 })).toBe('ok');
    expect(checkImageSource({ type: 'image/webp', size: 1 })).toBe('ok');
  });

  it('rechaza otros tipos y más de 2 MB', () => {
    expect(checkImageSource({ type: 'image/gif', size: 1 })).toBe('unsupported');
    expect(checkImageSource({ type: 'application/pdf', size: 1 })).toBe('unsupported');
    expect(checkImageSource({ type: 'image/heic', size: 1 })).toBe('unsupported');
    expect(checkImageSource({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toBe('too-large');
  });

  it('la etiqueta del límite es «2 MB»', () => {
    expect(IMAGE_SOURCE_MAX_LABEL).toBe('2 MB');
  });
});

describe('encodeImage', () => {
  it('usa WebP si el navegador lo exporta', async () => {
    const toBlob = vi.fn(async (type: string) => new Blob(['x'], { type }));
    expect((await encodeImage(toBlob)).type).toBe('image/webp');
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledWith('image/webp', 0.85);
  });

  it('cae a JPEG si devuelve otro tipo (Safari da PNG)', async () => {
    const toBlob = vi.fn(async (type: string) =>
      type === 'image/webp' ? new Blob(['x'], { type: 'image/png' }) : new Blob(['x'], { type }),
    );
    expect((await encodeImage(toBlob)).type).toBe('image/jpeg');
    expect(toBlob).toHaveBeenLastCalledWith('image/jpeg', 0.85);
  });

  it('falla si no exporta nada', async () => {
    await expect(encodeImage(async () => null)).rejects.toThrow();
  });
});
