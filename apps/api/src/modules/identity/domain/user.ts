export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Lo que el login con Google aporta de la persona. */
export interface GoogleIdentity {
  googleSub: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

/** Pertenencia activa de un usuario a una empresa. */
export interface Membership {
  memberId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: MemberRole;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
