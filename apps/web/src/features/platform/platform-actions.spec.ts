import type { PlatformTenantRow } from '@omnidesk/contracts';
import { describe, expect, it, vi } from 'vitest';
import { rowActions, type PlatformRowHandlers } from './platform-actions';

const base: PlatformTenantRow = {
  id: '0199c0de-0000-7000-8000-000000000001',
  name: 'Acme',
  slug: 'acme',
  requester: { displayName: 'Ana', email: 'ana@example.com' },
  contactPhone: null,
  contactEmail: null,
  requestedAt: '2026-10-15T10:00:00.000Z',
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  state: null,
  suspensionReason: null,
};

function handlers(): PlatformRowHandlers {
  return {
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onSuspend: vi.fn(),
    onUnsuspend: vi.fn(),
    onDelete: vi.fn(),
  };
}

const labels = (actions: ReturnType<typeof rowActions>) => ({
  main: actions.main?.label ?? null,
  menu: actions.menu.map((action) => action.label),
});

describe('rowActions (SPEC 21)', () => {
  it('pendiente: botón Aprobar y Rechazar en el menú', () => {
    const h = handlers();
    const actions = rowActions(base, 'pending', h);
    expect(labels(actions)).toEqual({ main: 'Aprobar', menu: ['Rechazar'] });

    actions.main!.run();
    actions.menu[0]!.run();
    expect(h.onApprove).toHaveBeenCalledWith(base);
    expect(h.onReject).toHaveBeenCalledWith(base);
  });

  it.each(['active', 'inactive'] as const)(
    'aprobada %s: sin botón y Suspender en el menú',
    (state) => {
      const row = { ...base, state };
      expect(labels(rowActions(row, 'approved', handlers()))).toEqual({
        main: null,
        menu: ['Suspender'],
      });
    },
  );

  it('aprobada suspendida: botón Levantar suspensión y Borrar en el menú', () => {
    const h = handlers();
    const row = { ...base, state: 'suspended' as const };
    const actions = rowActions(row, 'approved', h);
    expect(labels(actions)).toEqual({ main: 'Levantar suspensión', menu: ['Borrar'] });

    actions.main!.run();
    actions.menu[0]!.run();
    expect(h.onUnsuspend).toHaveBeenCalledWith(row);
    expect(h.onDelete).toHaveBeenCalledWith(row);
  });

  it('rechazada: sin acciones', () => {
    expect(labels(rowActions(base, 'rejected', handlers()))).toEqual({ main: null, menu: [] });
  });
});
