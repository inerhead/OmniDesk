import type { Membership } from '../../domain/user';

/** Lectura de las membresías activas (sin `removedAt`) de un usuario. */
export interface MembershipRepository {
  /** Ordenadas por nombre de la empresa. */
  listForUser(userId: string): Promise<Membership[]>;
  findForUser(userId: string, tenantId: string): Promise<Membership | null>;
  /** Membresía activa por id de miembro, con su usuario (para el login de desarrollo). */
  findByMemberId(memberId: string): Promise<(Membership & { userId: string | null }) | null>;
  /** Miembros activos con usuario de una empresa, por slug (los botones del login de desarrollo). */
  listLoginMembersOfTenant(
    tenantSlug: string,
  ): Promise<Array<{ memberId: string; displayName: string; role: Membership['role'] }>>;
}

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');
