/** Puerto: comprueba si la base de datos responde. */
export interface DatabaseHealthPort {
  ping(): Promise<boolean>;
}

export const DATABASE_HEALTH_PORT = Symbol('DATABASE_HEALTH_PORT');
