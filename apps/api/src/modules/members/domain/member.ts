export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

export interface Member {
  id: string;
  tenantId: string;
  displayName: string;
  email: string;
  role: MemberRole;
  /** Foto resuelta de su usuario (SPEC 15); `null` sin foto o sin usuario enlazado. */
  avatarUrl: string | null;
}

export type NewMember = Pick<Member, 'displayName' | 'email' | 'role'> & {
  /** Usuario de la persona (SPEC 07). */
  userId?: string;
};
