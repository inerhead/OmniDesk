import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Empresa en nombre de la que se atiende el trabajo en curso (SPEC 12). Dentro, `PrismaDb` y el
 * `TransactionRunner` usan el rol de aplicación con `app.tenant_id` fijado, y Row Level Security
 * solo deja ver y escribir filas de esa empresa. Fuera (caminos de sistema), el rol dueño.
 */
const scope = new AsyncLocalStorage<string>();

export function runInTenantScope<T>(tenantId: string, work: () => T): T {
  return scope.run(tenantId, work);
}

/** La empresa del trabajo en curso, o `undefined` en un camino de sistema. */
export function currentTenantId(): string | undefined {
  return scope.getStore();
}
