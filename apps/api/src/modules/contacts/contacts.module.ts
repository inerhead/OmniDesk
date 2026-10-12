import { Module } from '@nestjs/common';
import { CONTACT_REPOSITORY } from './application/ports/contact.repository';
import { PrismaContactRepository } from './infrastructure/prisma-contact.repository';

@Module({
  providers: [{ provide: CONTACT_REPOSITORY, useClass: PrismaContactRepository }],
  exports: [CONTACT_REPOSITORY],
})
export class ContactsModule {}
