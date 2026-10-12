import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SeedDemoUseCase } from './application/seed-demo.use-case';
import { DemoSeedService } from './infrastructure/demo-seed.service';
import { DemoTenantGuard } from './infrastructure/http/demo-tenant.guard';

@Module({
  imports: [TenancyModule, ChannelsModule],
  providers: [SeedDemoUseCase, DemoSeedService, DemoTenantGuard],
  exports: [DemoTenantGuard, TenancyModule],
})
export class DemoModule {}
