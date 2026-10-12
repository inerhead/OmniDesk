export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';
export type InvitableRole = 'ADMIN' | 'AGENT';

/** Vigencia de una invitación por enlace. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Permisos de gestión de la empresa (docs/specs/07):
 * OWNER invita ADMIN/AGENT, cambia roles y quita a cualquiera; ADMIN invita, revoca y quita AGENT.
 */
export function canInvite(actor: MemberRole, role: InvitableRole): boolean {
  if (actor === 'OWNER') return true;
  return actor === 'ADMIN' && role === 'AGENT';
}

/** Ver las invitaciones pendientes: OWNER y ADMIN. */
export function canListInvitations(actor: MemberRole): boolean {
  return actor === 'OWNER' || actor === 'ADMIN';
}

export function canRevokeInvitation(actor: MemberRole, invitationRole: MemberRole): boolean {
  return canInvite(actor, invitationRole as InvitableRole);
}

export function canChangeRole(actor: MemberRole): boolean {
  return actor === 'OWNER';
}

export function canRemove(actor: MemberRole, target: MemberRole): boolean {
  if (actor === 'OWNER') return true;
  return actor === 'ADMIN' && target === 'AGENT';
}

/** ¿Dejaría la empresa sin OWNER degradar o quitar a `memberId`? */
export function leavesNoOwner(ownerIds: string[], memberId: string): boolean {
  return ownerIds.includes(memberId) && ownerIds.length <= 1;
}

export interface InvitationLifecycle {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** Pendiente: sin usar, sin revocar y sin vencer. */
export function isInvitationPending(invitation: InvitationLifecycle, now: Date): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}

/** "laura@ejemplo.com" → "la***@ejemplo.com": la vista previa es pública. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
