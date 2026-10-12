export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

export interface Member {
  id: string;
  tenantId: string;
  displayName: string;
  email: string;
  role: MemberRole;
}

export type NewMember = Pick<Member, 'displayName' | 'email' | 'role'>;
