/**
 * Versión de la app que usa este dispositivo (SPEC 29): el tag `vX.Y.Z` con el que se construyó la
 * imagen del gateway, o `dev` en local. Puede ir por detrás de la del servidor si el service worker
 * sigue sirviendo el bundle anterior.
 */
export const appVersion: string = __APP_VERSION__;
