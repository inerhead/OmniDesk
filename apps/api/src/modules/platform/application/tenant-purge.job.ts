import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { PLATFORM_ADMINS, type PlatformAdmins } from '../../../shared/application/platform-admins';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  ATTACHMENT_STORAGE,
  tenantStoragePrefix,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import { avatarStoragePrefix } from '../../profile/domain/avatar-image';
import { JOB_LOCK, type JobLock } from '../../retention/application/ports/job-lock';
import {
  isOrphanAccount,
  TENANT_PURGE_BATCH_SIZE,
  TENANT_PURGE_LOCK_NAME,
} from '../domain/tenant-purge';
import {
  TENANT_DELETION_REPOSITORY,
  type TenantDeletionRepository,
} from './ports/tenant-deletion.repository';
import {
  TENANT_PURGE_STORE,
  type PurgedConversations,
  type TenantPurgeStore,
} from './ports/tenant-purge.store';

export interface TenantPurgeResult {
  tenantId: string;
  conversations: number;
  messages: number;
  attachments: number;
  objects: number;
  members: number;
  users: number;
  /** Se interrumpió: lo ya borrado queda borrado y la siguiente pasada sigue. */
  failed: boolean;
}

/**
 * Borrado de empresas (SPEC 20). Por cada empresa con `deletionRequestedAt`, la más antigua primero:
 * 1. conversaciones por lotes (con sus mensajes, adjuntos y eventos), cada lote con su conteo;
 * 2. el prefijo `tenants/<id>/` del bucket;
 * 3. el resto de filas, las cuentas huérfanas y la empresa, en una transacción;
 * 4. tras el commit, las fotos de esas cuentas, sin reintento.
 * Cada paso es idempotente: si uno falla, la empresa sigue en borrado y la siguiente pasada retoma.
 */
@Injectable()
export class TenantPurgeJob {
  private readonly logger = new Logger(TenantPurgeJob.name);

  constructor(
    @Inject(TENANT_PURGE_STORE) private readonly store: TenantPurgeStore,
    @Inject(TENANT_DELETION_REPOSITORY) private readonly deletions: TenantDeletionRepository,
    @Inject(JOB_LOCK) private readonly lock: JobLock,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(PLATFORM_ADMINS) private readonly admins: PlatformAdmins,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `null` si otra instancia ya lo está ejecutando. */
  async run(): Promise<TenantPurgeResult[] | null> {
    const outcome = await this.lock.tryRun(TENANT_PURGE_LOCK_NAME, () => this.execute());
    return outcome.acquired ? outcome.result : null;
  }

  private async execute(): Promise<TenantPurgeResult[]> {
    const results: TenantPurgeResult[] = [];
    for (const tenantId of await this.store.tenantsToPurge()) {
      results.push(await this.purge(tenantId));
    }
    return results;
  }

  private async purge(tenantId: string): Promise<TenantPurgeResult> {
    const result: TenantPurgeResult = {
      tenantId,
      conversations: 0,
      messages: 0,
      attachments: 0,
      objects: 0,
      members: 0,
      users: 0,
      failed: false,
    };
    try {
      for (;;) {
        const batch = await this.tx.run(() => this.deleteBatch(tenantId), { timeoutMs: 120_000 });
        if (!batch) break;
        result.conversations += batch.conversations;
        result.messages += batch.messages;
        result.attachments += batch.attachments;
      }

      result.objects = await this.storage.deletePrefix(tenantStoragePrefix(tenantId));
      if (result.objects > 0) {
        await this.store.addProgress(tenantId, { objectsDeleted: result.objects });
      }

      const remainder = await this.tx.run(() => this.deleteRemainder(tenantId), {
        timeoutMs: 120_000,
      });
      result.members = remainder.members;
      result.users = remainder.users;
      await this.deleteAvatars(remainder.orphanUserIds);
    } catch (error) {
      result.failed = true;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Borrado de la empresa ${tenantId}: interrumpido: ${message}`);
      await this.store
        .recordError(tenantId, message)
        .catch((recordError: unknown) =>
          this.logger.error(
            `Borrado de la empresa ${tenantId}: sin constancia del error: ${String(recordError)}`,
          ),
        );
      return result;
    }
    this.logger.log(
      `Empresa ${tenantId} borrada: ${result.conversations} conversaciones, ` +
        `${result.messages} mensajes, ${result.attachments} adjuntos, ${result.objects} objetos, ` +
        `${result.members} miembros y ${result.users} cuentas`,
    );
    return result;
  }

  /** Un lote en una transacción, con su conteo. `null` cuando ya no quedan conversaciones. */
  private async deleteBatch(tenantId: string): Promise<PurgedConversations | null> {
    const ids = await this.store.lockConversations(tenantId, TENANT_PURGE_BATCH_SIZE);
    if (ids.length === 0) return null;
    const batch = await this.store.deleteConversations(tenantId, ids);
    await this.store.addProgress(tenantId, {
      conversationsDeleted: batch.conversations,
      messagesDeleted: batch.messages,
      attachmentsDeleted: batch.attachments,
    });
    return batch;
  }

  /** La regla de cuentas huérfanas se evalúa aquí, dentro de la transacción que las borra. */
  private async deleteRemainder(tenantId: string) {
    const accounts = await this.deletions.memberAccounts(tenantId);
    const orphanUserIds = accounts
      .filter((account) => isOrphanAccount(account, (email) => this.admins.isPlatformAdmin(email)))
      .map((account) => account.userId);
    const remainder = await this.store.deleteRemainder(tenantId, orphanUserIds, this.clock.now());
    return { ...remainder, orphanUserIds };
  }

  /** Las fotos viven bajo `users/<userId>/`. Un fallo solo se registra: la cuenta ya no existe. */
  private async deleteAvatars(userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      const prefix = avatarStoragePrefix(userId);
      await this.storage
        .deletePrefix(prefix)
        .catch((error: unknown) =>
          this.logger.warn(`Foto de la cuenta borrada sin borrar (${prefix}): ${String(error)}`),
        );
    }
  }
}
