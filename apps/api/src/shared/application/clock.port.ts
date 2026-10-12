/** Puerto: hora actual. Las pruebas lo sustituyen por un reloj falso. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
