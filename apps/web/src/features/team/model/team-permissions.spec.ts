import { describe, expect, it } from 'vitest';
import {
  canChangeRoles,
  canManageTeam,
  canRemoveMember,
  canRevokeInvitation,
  invitableRoles,
} from './team-permissions';

describe('permisos de la pantalla de miembros', () => {
  it('OWNER invita ADMIN y AGENT; ADMIN solo AGENT; AGENT a nadie', () => {
    expect(invitableRoles('OWNER')).toEqual(['AGENT', 'ADMIN']);
    expect(invitableRoles('ADMIN')).toEqual(['AGENT']);
    expect(invitableRoles('AGENT')).toEqual([]);
  });

  it('solo OWNER y ADMIN gestionan; solo OWNER cambia roles', () => {
    expect(canManageTeam('ADMIN')).toBe(true);
    expect(canManageTeam('AGENT')).toBe(false);
    expect(canChangeRoles('OWNER')).toBe(true);
    expect(canChangeRoles('ADMIN')).toBe(false);
  });

  it('ADMIN quita y revoca solo lo de AGENT', () => {
    expect(canRemoveMember('ADMIN', 'AGENT')).toBe(true);
    expect(canRemoveMember('ADMIN', 'ADMIN')).toBe(false);
    expect(canRemoveMember('OWNER', 'OWNER')).toBe(true);
    expect(canRevokeInvitation('ADMIN', 'ADMIN')).toBe(false);
    expect(canRevokeInvitation('OWNER', 'ADMIN')).toBe(true);
  });
});
