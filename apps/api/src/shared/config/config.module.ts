import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../application/clock.port';
import { PLATFORM_ADMINS, PlatformAdmins } from '../application/platform-admins';
import { APP_VERSION, DEV_VERSION } from './app-version';
import { ENV, type Env } from './env';

const systemClock: Clock = { now: () => new Date() };

/** Admins de plataforma (SPEC 18). Sin ninguno, el API arranca igual y lo avisa. */
function platformAdmins(env: Env): PlatformAdmins {
  const admins = PlatformAdmins.fromEnv(env);
  if (admins.isEmpty) {
    new Logger('PlatformAdmins').warn(
      'PLATFORM_ADMIN_EMAILS está vacío: nadie puede aprobar empresas y las solicitudes se quedan en revisión',
    );
  }
  return admins;
}

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
        { provide: PLATFORM_ADMINS, useFactory: () => platformAdmins(env) },
      ],
      exports: [ENV, APP_VERSION, CLOCK, PLATFORM_ADMINS],
    };
  }
}
