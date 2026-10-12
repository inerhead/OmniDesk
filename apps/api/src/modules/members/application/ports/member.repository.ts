import type { Member, MemberRole, NewMember } from '../../domain/member';

export interface MemberRepository {
  /** Crea el miembro o, si ya existe `(tenantId, email)`, actualiza su nombre y rol. */
  upsertByEmail(tenantId: string, data: NewMember): Promise<Member>;
  /** Solo miembros activos: uno dado de baja (`removedAt`) no existe para asignar ni listar. */
  findById(tenantId: string, id: string): Promise<Member | null>;
  /** Activos, ordenados por rol (OWNER, ADMIN, AGENT) y luego por nombre. */
  list(tenantId: string): Promise<Member[]>;
  /** Miembro activo con ese email (sin distinguir mayúsculas: se guarda en minúsculas). */
  findActiveByEmail(tenantId: string, email: string): Promise<Member | null>;
  /**
   * Alta por invitación: crea el miembro o reactiva la fila dada de baja del mismo email
   * (`removedAt = null`, rol nuevo), enlazada al usuario.
   */
  admit(tenantId: string, data: Required<NewMember>): Promise<Member>;
  /**
   * Bloquea (`SELECT … FOR UPDATE`) los OWNER activos de la empresa y devuelve sus ids. Se llama dentro
   * de la transacción que degrada o quita a alguien, para que siempre quede al menos uno.
   */
  lockOwners(tenantId: string): Promise<string[]>;
  updateRole(tenantId: string, id: string, role: MemberRole): Promise<Member>;
  /** Baja lógica; devuelve el usuario del miembro para revocar sus sesiones. */
  markRemoved(tenantId: string, id: string, at: Date): Promise<{ userId: string | null }>;
}

export const MEMBER_REPOSITORY = Symbol('MEMBER_REPOSITORY');
