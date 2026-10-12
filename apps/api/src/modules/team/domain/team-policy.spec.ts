import { describe, expect, it } from 'vitest';
import {
  canChangeRole,
  canInvite,
  canListInvitations,
  canRemove,
  canRevokeInvitation,
  INVITATION_TTL_MS,
  isInvitationPending,
  leavesNoOwner,
  maskEmail,
} from './team-policy';

describe('permisos de la empresa', () => {
  it('invitar: OWNER a ADMIN y AGENT; ADMIN solo a AGENT; AGENT a nadie', () => {
    expect(canInvite('OWNER', 'ADMIN')).toBe(true);
    expect(canInvite('OWNER', 'AGENT')).toBe(true);
    expect(canInvite('ADMIN', 'ADMIN')).toBe(false);
    expect(canInvite('ADMIN', 'AGENT')).toBe(true);
    expect(canInvite('AGENT', 'AGENT')).toBe(false);
  });

  it('ver y revocar invitaciones', () => {
    expect(canListInvitations('ADMIN')).toBe(true);
    expect(canListInvitations('AGENT')).toBe(false);
    expect(canRevokeInvitation('ADMIN', 'AGENT')).toBe(true);
    expect(canRevokeInvitation('ADMIN', 'ADMIN')).toBe(false);
    expect(canRevokeInvitation('OWNER', 'ADMIN')).toBe(true);
  });

  it('cambiar rol: solo OWNER', () => {
    expect(canChangeRole('OWNER')).toBe(true);
    expect(canChangeRole('ADMIN')).toBe(false);
    expect(canChangeRole('AGENT')).toBe(false);
  });

  it('quitar: OWNER a cualquiera; ADMIN solo a AGENT', () => {
    expect(canRemove('OWNER', 'OWNER')).toBe(true);
    expect(canRemove('OWNER', 'ADMIN')).toBe(true);
    expect(canRemove('ADMIN', 'AGENT')).toBe(true);
    expect(canRemove('ADMIN', 'ADMIN')).toBe(false);
    expect(canRemove('ADMIN', 'OWNER')).toBe(false);
    expect(canRemove('AGENT', 'AGENT')).toBe(false);
  });

  it('siempre queda al menos un OWNER', () => {
    expect(leavesNoOwner(['o1'], 'o1')).toBe(true);
    expect(leavesNoOwner(['o1', 'o2'], 'o1')).toBe(false);
    expect(leavesNoOwner(['o1'], 'a1')).toBe(false);
  });
});

describe('invitaciones', () => {
  const now = new Date('2026-10-12T10:00:00.000Z');
  const pending = {
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    revokedAt: null,
  };

  it('pendiente hasta que se usa, se revoca o vence a los 7 días', () => {
    expect(isInvitationPending(pending, now)).toBe(true);
    expect(isInvitationPending({ ...pending, acceptedAt: now }, now)).toBe(false);
    expect(isInvitationPending({ ...pending, revokedAt: now }, now)).toBe(false);
    expect(isInvitationPending(pending, pending.expiresAt)).toBe(false);
  });

  it('enmascara el email', () => {
    expect(maskEmail('laura@ejemplo.com')).toBe('la***@ejemplo.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });
});
