/** Token de inyección para la versión del API. */
export const APP_VERSION = Symbol('APP_VERSION');

/** Versión sin `APP_VERSION` (desarrollo local): `deploy.sh` la fija con la etiqueta o el commit. */
export const DEV_VERSION = 'dev';
