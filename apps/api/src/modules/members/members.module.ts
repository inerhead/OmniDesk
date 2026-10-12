import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ListMembersUseCase } from './application/list-members.use-case';
import { MEMBER_REPOSITORY } from './application/ports/member.repository';
import { MembersController } from './infrastructure/http/members.controller';
import { PrismaMemberRepository } from './infrastructure/prisma-member.repository';

@Module({
  imports: [IdentityModule],
  controllers: [MembersController],
  providers: [{ provide: MEMBER_REPOSITORY, useClass: PrismaMemberRepository }, ListMembersUseCase],
  exports: [MEMBER_REPOSITORY],
})
export class MembersModule {}
