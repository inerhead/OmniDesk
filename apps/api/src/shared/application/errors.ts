/**
 * Una restricción única de la base de datos chocó por una carrera entre transacciones.
 * Los repositorios la traducen desde el error del ORM; los casos de uso reintentan.
 */
export class UniqueConflictError extends Error {
  constructor(readonly constraint: string) {
    super(`Conflicto de unicidad: ${constraint}`);
    this.name = 'UniqueConflictError';
  }
}
