import { describe, expect, it } from 'vitest';
import { tenantState } from './tenant-state';

const at = new Date('2026-10-15T10:00:00Z');

describe('tenantState', () => {
  it('en borrado gana a todo lo demás (SPEC 20)', () => {
    expect(
      tenantState({
        approval: 'APPROVED',
        suspendedAt: at,
        deactivatedAt: at,
        deletionRequestedAt: at,
      }),
    ).toBe('deleting');
  });

  it('activa: aprobada, sin suspender ni inactivar', () => {
    expect(
      tenantState({
        approval: 'APPROVED',
        suspendedAt: null,
        deactivatedAt: null,
        deletionRequestedAt: null,
      }),
    ).toBe('active');
  });

  it('en revisión gana a todo lo demás', () => {
    expect(
      tenantState({
        approval: 'PENDING',
        suspendedAt: at,
        deactivatedAt: at,
        deletionRequestedAt: null,
      }),
    ).toBe('pending');
  });

  it('la suspensión manda sobre la inactivación del Owner', () => {
    expect(
      tenantState({
        approval: 'APPROVED',
        suspendedAt: at,
        deactivatedAt: at,
        deletionRequestedAt: null,
      }),
    ).toBe('suspended');
  });

  it('inactiva: aprobada, sin suspender y con deactivatedAt', () => {
    expect(
      tenantState({
        approval: 'APPROVED',
        suspendedAt: null,
        deactivatedAt: at,
        deletionRequestedAt: null,
      }),
    ).toBe('inactive');
  });
});
