import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ENV, type Env } from '../../../shared/config/env';
import { sha256Hex } from '../../../shared/infrastructure/crypto/sha256';
import { SeedDemoUseCase } from '../application/seed-demo.use-case';

/** Con DEMO_MODE=true, siembra los datos demo al arrancar el API. */
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly seedDemo: SeedDemoUseCase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.DEMO_MODE || !this.env.DEMO_CHANNEL_API_KEY) return;
    try {
      await this.seedDemo.execute(sha256Hex(this.env.DEMO_CHANNEL_API_KEY));
      this.logger.log('Datos demo listos (tenant "demo", 3 miembros, canal "WhatsApp Demo")');
    } catch (error) {
      // Sin base de datos al arrancar, el API sigue vivo y el health lo reporta.
      this.logger.warn(`No se pudieron sembrar los datos demo: ${String(error)}`);
    }
  }
}
