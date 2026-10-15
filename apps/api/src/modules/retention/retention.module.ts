import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { IdentityModule } from '../identity/identity.module';
import { DeleteContactUseCase } from './application/delete-contact.use-case';
import { JOB_LOCK } from './application/ports/job-lock';
import { RETENTION_STORE } from './application/ports/retention-store';
import { RetentionJob } from './application/retention-job';
import { ContactsController } from './infrastructure/http/contacts.controller';
import { PgJobLock } from './infrastructure/pg-job-lock';
import { PrismaRetentionStore } from './infrastructure/prisma-retention.store';
import { RetentionScheduler } from './infrastructure/retention-scheduler';

/** Borrado de datos (SPEC 12): retención diaria, purga técnica y borrado de un contacto a petición. */
@Module({
  imports: [AttachmentsModule, IdentityModule],
  controllers: [ContactsController],
  providers: [
    DeleteContactUseCase,
    { provide: RETENTION_STORE, useClass: PrismaRetentionStore },
    { provide: JOB_LOCK, useClass: PgJobLock },
    RetentionJob,
    RetentionScheduler,
  ],
  exports: [RetentionJob],
})
export class RetentionModule {}
