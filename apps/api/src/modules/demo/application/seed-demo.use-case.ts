import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  CHANNEL_REPOSITORY,
  type ChannelRepository,
} from '../../channels/application/ports/channel.repository';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from '../../tenancy/application/ports/tenant.repository';
import { DEMO_CHANNEL, DEMO_TENANT } from './demo.constants';

/** Crea o actualiza tenant, canal y credencial demo. Idempotente. */
@Injectable()
export class SeedDemoUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
  ) {}

  execute(apiKeyHash: string): Promise<void> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.upsertBySlug(DEMO_TENANT);
      const channel = await this.channels.upsertChannel(tenant.id, DEMO_CHANNEL);
      await this.channels.setOnlyActiveCredential(tenant.id, channel.id, apiKeyHash);
    });
  }
}
