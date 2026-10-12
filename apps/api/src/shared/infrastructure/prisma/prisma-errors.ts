import { Prisma } from '../../../generated/prisma/client';
import { UniqueConflictError } from '../../application/errors';

/** Traduce una violación de unicidad de Prisma (P2002) a `UniqueConflictError`; relanza lo demás. */
export function rethrowUniqueConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new UniqueConflictError(JSON.stringify(error.meta ?? {}));
  }
  throw error;
}
