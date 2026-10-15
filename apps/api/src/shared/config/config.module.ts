import { DynamicModule, Global, Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../application/clock.port';
import { APP_VERSION, DEV_VERSION } from './app-version';
import { ENV, type Env } from './env';

const systemClock: Clock = { now: () => new Date() };

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_VERSION, useValue: env.APP_VERSION ?? DEV_VERSION },
        { provide: CLOCK, useValue: systemClock },
      ],
      exports: [ENV, APP_VERSION, CLOCK],
    };
  }
}
