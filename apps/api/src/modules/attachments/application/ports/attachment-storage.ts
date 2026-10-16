import type { Readable } from 'node:stream';
import type { ByteRange } from '../../domain/byte-range';

export interface StoredObject {
  body: Readable;
}

/** Bucket privado de los adjuntos: los bytes solo salen por el API. */
export interface AttachmentStorage {
  /** `contentLength` es obligatorio: S3 no acepta un stream sin tamaño. */
  put(
    key: string,
    body: Buffer | Readable,
    options: { contentType: string; contentLength: number },
  ): Promise<void>;
  get(key: string, range?: ByteRange): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Borra todos los objetos bajo el prefijo y devuelve cuántos borró. Idempotente (SPEC 20). */
  deletePrefix(prefix: string): Promise<number>;
}

export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

/** Entrantes: determinista, un reintento de la descarga sobrescribe el mismo objeto. */
export function attachmentStorageKey(tenantId: string, attachmentId: string): string {
  return `tenants/${tenantId}/attachments/${attachmentId}`;
}

/** Todo lo de una empresa vive bajo este prefijo: adjuntos entrantes, salientes y logo (SPEC 20). */
export function tenantStoragePrefix(tenantId: string): string {
  return `tenants/${tenantId}/`;
}

/** Salientes: se suben antes de que exista la fila. */
export function outboundStorageKey(tenantId: string, token: string): string {
  return `tenants/${tenantId}/attachments/out-${token}`;
}
