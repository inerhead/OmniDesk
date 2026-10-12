import type { MemberRole } from '@omnidesk/contracts';

/**
 * Lo que la pantalla de miembros ofrece según el rol (el API siempre decide; docs/specs/07):
 * OWNER invita ADMIN/AGENT, cambia roles y quita a cualquiera; ADMIN invita, revoca y quita AGENT.
 */
export function invitableRoles(actor: MemberRole): Array<'ADMIN' | 'AGENT'> {
  if (actor === 'OWNER') return ['AGENT', 'ADMIN'];
  return actor === 'ADMIN' ? ['AGENT'] : [];
}

export const canManageTeam = (actor: MemberRole) => actor === 'OWNER' || actor === 'ADMIN';

export const canChangeRoles = (actor: MemberRole) => actor === 'OWNER';

export function canRemoveMember(actor: MemberRole, target: MemberRole): boolean {
  if (actor === 'OWNER') return true;
  return actor === 'ADMIN' && target === 'AGENT';
}

export const canRevokeInvitation = (actor: MemberRole, role: MemberRole) =>
  actor === 'OWNER' || (actor === 'ADMIN' && role === 'AGENT');
