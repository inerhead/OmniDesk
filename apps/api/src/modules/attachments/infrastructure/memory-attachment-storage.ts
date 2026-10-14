import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import type { AttachmentStorage, StoredObject } from '../application/ports/attachment-storage';
import type { ByteRange } from '../domain/byte-range';

/** Solo pruebas y desarrollo sin MinIO: el contenido se pierde al reiniciar. */
export class MemoryAttachmentStorage implements AttachmentStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(
    key: string,
    body: Buffer | Readable,
    options: { contentType: string; contentLength: number },
  ): Promise<void> {
    const bytes = Buffer.isBuffer(body) ? body : await buffer(body);
    if (bytes.length !== options.contentLength)
      throw new Error(`El tamaño no coincide: ${bytes.length} ≠ ${options.contentLength}`);
    this.objects.set(key, bytes);
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject> {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`El objeto ${key} no existe`);
    return { body: Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]) };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
