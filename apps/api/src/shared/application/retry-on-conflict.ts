import { UniqueConflictError } from './errors';

/**
 * Ejecuta `attempt` y, si choca con una restricción única por una carrera, lo reintenta una vez.
 * `attempt` debe abrir su propia transacción: la que falló quedó abortada.
 */
export async function retryOnConflict<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof UniqueConflictError) return attempt();
    throw error;
  }
}
