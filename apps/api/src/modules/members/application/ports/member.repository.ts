import type { Member, NewMember } from '../../domain/member';

export interface MemberRepository {
  /** Crea el miembro o, si ya existe `(tenantId, email)`, actualiza su nombre y rol. */
  upsertByEmail(tenantId: string, data: NewMember): Promise<Member>;
  findById(tenantId: string, id: string): Promise<Member | null>;
  /** Ordenados por rol (OWNER, ADMIN, AGENT) y luego por nombre. */
  list(tenantId: string): Promise<Member[]>;
}

export const MEMBER_REPOSITORY = Symbol('MEMBER_REPOSITORY');
