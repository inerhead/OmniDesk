import type { AttachmentStorage } from '../../attachments/application/ports/attachment-storage';

/** Objetos del bucket que se borran a la vez. */
const STORAGE_DELETE_CONCURRENCY = 20;

/**
 * Borra del bucket los adjuntos de lo que se va a borrar. Los objetos no caen en cascada con las
 * filas: se borran antes que las filas que los nombran, dentro de la misma transacción.
 */
export async function deleteStoredObjects(
  storage: AttachmentStorage,
  keys: string[],
): Promise<void> {
  for (let index = 0; index < keys.length; index += STORAGE_DELETE_CONCURRENCY) {
    const chunk = keys.slice(index, index + STORAGE_DELETE_CONCURRENCY);
    await Promise.all(chunk.map((key) => storage.delete(key)));
  }
}
