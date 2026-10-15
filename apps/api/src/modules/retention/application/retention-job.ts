import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import { tenantRejectionCutoff } from '../../identity/application/ports/tenant-rejection.repository';
import { retentionCutoff } from '../../tenancy/domain/retention';
import { RETENTION_BATCH_SIZE, technicalPurgeCutoff } from '../domain/retention-schedule';
import { deleteStoredObjects } from './delete-stored-objects';
import { JOB_LOCK, type JobLock } from './ports/job-lock';
import {
  RETENTION_STORE,
  type RetentionStore,
  type TechnicalPurgeResult,
  type TenantRetention,
} from './ports/retention-store';

export const RETENTION_LOCK_NAME = 'omnidesk:retention';

export interface TenantRetentionResult {
  tenantId: string;
  conversations: number;
  messages: number;
  contacts: number;
  /** El borrado de esta empresa se interrumpió; lo que ya se borró queda borrado. */
  failed: boolean;
}

export interface RetentionRunReport {
  tenants: TenantRetentionResult[];
  purge: TechnicalPurgeResult;
  /** Rechazos de solicitudes de empresa de más de 20 días (SPEC 18). */
  tenantRejections: number;
}

/**
 * Retención diaria (SPEC 12): por cada empresa con `retentionDays`, borra las conversaciones
 * cerradas antiguas (con sus adjuntos del bucket) y los contactos que quedan sin conversaciones;
 * después purga las tablas técnicas y los rechazos de solicitudes de más de 20 días (SPEC 18). Corre
 * una sola vez a la vez entre instancias (advisory lock).
 */
@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    @Inject(RETENTION_STORE) private readonly store: RetentionStore,
    @Inject(JOB_LOCK) private readonly lock: JobLock,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `null` si otra instancia ya lo está ejecutando. */
  async run(now: Date = this.clock.now()): Promise<RetentionRunReport | null> {
    const outcome = await this.lock.tryRun(RETENTION_LOCK_NAME, () => this.execute(now));
    if (!outcome.acquired) {
      this.logger.log('Retención: otra instancia la está ejecutando; no se hace nada');
      return null;
    }
    return outcome.result;
  }

  private async execute(now: Date): Promise<RetentionRunReport> {
    const tenants: TenantRetentionResult[] = [];
    for (const tenant of await this.store.tenantsWithRetention()) {
      tenants.push(await this.applyTenant(tenant, now));
    }
    const purge = await this.store.purgeTechnical(technicalPurgeCutoff(now));
    this.logger.log(
      `Purga técnica: ${purge.outboxEvents} eventos del Outbox, ${purge.inboxEvents} del Inbox, ` +
        `${purge.sessions} sesiones y ${purge.invitations} invitaciones`,
    );
    const tenantRejections = await this.store.deleteTenantRejectionsBefore(
      tenantRejectionCutoff(now),
    );
    this.logger.log(`Retención: ${tenantRejections} rechazos de solicitudes borrados`);
    return { tenants, purge, tenantRejections };
  }

  private async applyTenant(
    { tenantId, retentionDays }: TenantRetention,
    now: Date,
  ): Promise<TenantRetentionResult> {
    const cutoff = retentionCutoff(now, retentionDays);
    const result: TenantRetentionResult = {
      tenantId,
      conversations: 0,
      messages: 0,
      contacts: 0,
      failed: false,
    };
    try {
      for (;;) {
        const batch = await this.tx.run(() => this.deleteBatch(tenantId, cutoff), {
          timeoutMs: 120_000,
        });
        if (!batch) break;
        result.conversations += batch.conversations;
        result.messages += batch.messages;
      }
      result.contacts = await this.store.deleteOrphanContacts(tenantId);
    } catch (error) {
      // Una empresa con problemas (p. ej. el bucket caído) no impide aplicar la retención al resto.
      result.failed = true;
      this.logger.error(`Retención ${tenantId}: interrumpida: ${String(error)}`);
    }
    if (result.conversations > 0) {
      await this.store.logDeletion({
        tenantId,
        kind: 'retention',
        actorMemberId: null,
        conversationsDeleted: result.conversations,
        messagesDeleted: result.messages,
      });
    }
    this.logger.log(
      `Retención ${tenantId} (${retentionDays} días): ${result.conversations} conversaciones, ` +
        `${result.messages} mensajes y ${result.contacts} contactos borrados`,
    );
    return result;
  }

  /** Un lote dentro de una transacción. `null` cuando ya no queda nada que borrar. */
  private async deleteBatch(tenantId: string, cutoff: Date) {
    const ids = await this.store.lockExpiredConversations(tenantId, cutoff, RETENTION_BATCH_SIZE);
    if (ids.length === 0) return null;
    // Los objetos del bucket no caen en cascada: se borran antes que las filas que los nombran.
    await deleteStoredObjects(this.storage, await this.store.attachmentKeys(tenantId, ids));
    return this.store.deleteConversations(tenantId, ids);
  }
}
