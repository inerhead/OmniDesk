import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_VERSION, readAppVersion } from './app-version';
import { ENV, type Env } from './env';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_VERSION, useValue: readAppVersion() },
      ],
      exports: [ENV, APP_VERSION],
    };
  }
}
