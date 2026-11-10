/** Versión de la app frente a la del servidor (SPEC 29). */
export type VersionStatus = 'same' | 'different' | 'unknown';

const DEV_VERSION = 'dev';

/**
 * Compara por texto exacto, sin mayor ni menor: tras un rollback del servidor la app también tiene
 * que actualizarse. `server` es `null` si el API no respondió. Con `dev` (local) no se compara.
 */
export function versionStatus(app: string, server: string | null): VersionStatus {
  if (server === null || app === DEV_VERSION || server === DEV_VERSION) return 'unknown';
  return app === server ? 'same' : 'different';
}
