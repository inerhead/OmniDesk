import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from './memory-attachment-storage';

describe('MemoryAttachmentStorage', () => {
  it('guarda un stream, lo lee entero o por rango y lo borra', async () => {
    const storage = new MemoryAttachmentStorage();
    await storage.put('k', Readable.from([Buffer.from('hola '), Buffer.from('mundo')]), {
      contentType: 'text/plain',
      contentLength: 10,
    });

    expect((await buffer((await storage.get('k')).body)).toString()).toBe('hola mundo');
    expect((await buffer((await storage.get('k', { start: 5, end: 9 })).body)).toString()).toBe(
      'mundo',
    );
    await storage.delete('k');
    await expect(storage.get('k')).rejects.toThrow(/no existe/);
  });

  it('rechaza un cuerpo cuyo tamaño no coincide, como S3', async () => {
    const storage = new MemoryAttachmentStorage();
    await expect(
      storage.put('k', Buffer.from('abc'), { contentType: 'text/plain', contentLength: 5 }),
    ).rejects.toThrow(/tamaño/);
  });
});
