/**
 * Puerto: ejecuta un trabajo dentro de una transacción.
 * Los casos de uso orquestan la transacción sin conocer el ORM.
 * Llamadas anidadas reutilizan la transacción activa.
 */
export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Ejecuta `work` fuera de la transacción activa. Para callbacks diferidos (temporizadores) creados
   * dentro de una transacción: heredarían la ya cerrada.
   */
  runDetached<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');
