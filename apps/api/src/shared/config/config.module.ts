import { DynamicModule, Global, Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../application/clock.port';
import { APP_VERSION, readAppVersion } from './app-version';
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
        { provide: APP_VERSION, useValue: readAppVersion() },
        { provide: CLOCK, useValue: systemClock },
      ],
      exports: [ENV, APP_VERSION, CLOCK],
    };
  }
}
