import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { IdentityModule } from '../identity/identity.module';
import { MembersModule } from '../members/members.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SeedDemoUseCase } from './application/seed-demo.use-case';
import { DemoSeedService } from './infrastructure/demo-seed.service';

/** Datos demo (solo `DEMO_MODE=true`): tenant, canal, credencial y miembros con su usuario. */
@Module({
  imports: [TenancyModule, ChannelsModule, MembersModule, IdentityModule],
  providers: [SeedDemoUseCase, DemoSeedService],
})
export class DemoModule {}
