import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { AppPrismaService } from './prisma.service';
import { currentTenantId, runInTenantScope } from './tenant-scope';

/**
 * Acceso a la base en nombre de una empresa (SPEC 12): rol de aplicación con `app.tenant_id` fijado
 * con `set_config(..., true)`, local a la transacción. Una variable de sesión se filtraría entre
 * peticiones por el pool de conexiones.
 */
@Injectable()
export class TenantPrisma {
  /**
   * Para las consultas sueltas (fuera de una transacción explícita): cada una va en una transacción
   * corta con su `set_config`. Así una lectura no retiene una conexión toda la petición.
   */
  readonly scopedClient: Prisma.TransactionClient;

  constructor(private readonly app: AppPrismaService) {
    this.scopedClient = app.$extends({
      query: {
        async $allOperations({ args, query }) {
          const tenantId = currentTenantId();
          // Sin empresa no se fija nada: con RLS activo no se ve ninguna fila (falla cerrado).
          if (!tenantId) return query(args);
          const [, result] = await app.$transaction([
            app.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    }) as unknown as Prisma.TransactionClient;
  }

  /** Ejecuta `work` en nombre de `tenantId`: todo acceso a la base dentro pasa por RLS. */
  run<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    // `await` dentro del contexto: una PrismaPromise solo se ejecuta al llamar a `then`, y fuera
    // del contexto lo haría con el rol de aplicación pero sin empresa (sin filas).
    return runInTenantScope(tenantId, async () => await work());
  }

  /** Transacción explícita con el rol de aplicación y `app.tenant_id` fijado desde el principio. */
  transaction<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeoutMs: number },
  ): Promise<T> {
    return this.app.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return work(tx);
      },
      options ? { timeout: options.timeoutMs } : undefined,
    );
  }
}
