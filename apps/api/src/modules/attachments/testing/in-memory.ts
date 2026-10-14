import type { AttachmentRecord, AttachmentRepository } from '../application/ports/attachment.repository';

export class InMemoryAttachments implements AttachmentRepository {
  readonly rows = new Map<string, AttachmentRecord & { failureReason: string | null }>();

  add(row: AttachmentRecord) {
    this.rows.set(row.id, { ...row, failureReason: null });
  }

  async findById(tenantId: string, id: string) {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async markReady(id: string, update: { storageKey: string; sizeBytes: number }) {
    Object.assign(this.rows.get(id)!, { status: 'READY', ...update, failureReason: null });
  }

  async markFailed(id: string, reason: string) {
    Object.assign(this.rows.get(id)!, { status: 'FAILED', failureReason: reason });
  }
}
