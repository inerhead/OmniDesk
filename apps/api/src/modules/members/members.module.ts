import { Module } from '@nestjs/common';
import { DemoTenantGuard } from '../demo/infrastructure/http/demo-tenant.guard';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ListMembersUseCase } from './application/list-members.use-case';
import { MEMBER_REPOSITORY } from './application/ports/member.repository';
import { MembersController } from './infrastructure/http/members.controller';
import { PrismaMemberRepository } from './infrastructure/prisma-member.repository';

@Module({
  // DemoModule importa este módulo (seed), así que el guard se provee aquí y no se importa DemoModule.
  imports: [TenancyModule],
  controllers: [MembersController],
  providers: [
    { provide: MEMBER_REPOSITORY, useClass: PrismaMemberRepository },
    ListMembersUseCase,
    DemoTenantGuard,
  ],
  exports: [MEMBER_REPOSITORY],
})
export class MembersModule {}
