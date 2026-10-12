import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { MembersModule } from '../members/members.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SeedDemoUseCase } from './application/seed-demo.use-case';
import { DemoSeedService } from './infrastructure/demo-seed.service';
import { DemoActorGuard } from './infrastructure/http/demo-actor.guard';
import { DemoTenantGuard } from './infrastructure/http/demo-tenant.guard';

@Module({
  imports: [TenancyModule, ChannelsModule, MembersModule],
  providers: [SeedDemoUseCase, DemoSeedService, DemoTenantGuard, DemoActorGuard],
  exports: [DemoTenantGuard, DemoActorGuard, TenancyModule],
})
export class DemoModule {}
