import type { PlatformTenantRow, PlatformTenantStatus } from '@omnidesk/contracts';

export interface PlatformRowHandlers {
  onApprove: (row: PlatformTenantRow) => void;
  onReject: (row: PlatformTenantRow) => void;
  onSuspend: (row: PlatformTenantRow) => void;
  onUnsuspend: (row: PlatformTenantRow) => void;
  onDelete: (row: PlatformTenantRow) => void;
}

interface Action {
  label: string;
  run: () => void;
}

/** La acción principal (botón) y las demás (menú "⋯") de cada fila (SPEC 21). */
export function rowActions(
  row: PlatformTenantRow,
  tab: PlatformTenantStatus,
  handlers: PlatformRowHandlers,
): { main: Action | null; menu: Action[] } {
  if (tab === 'pending') {
    return {
      main: { label: 'Aprobar', run: () => handlers.onApprove(row) },
      menu: [{ label: 'Rechazar', run: () => handlers.onReject(row) }],
    };
  }
  if (tab === 'approved' && row.state === 'suspended') {
    return {
      main: { label: 'Levantar suspensión', run: () => handlers.onUnsuspend(row) },
      menu: [{ label: 'Borrar', run: () => handlers.onDelete(row) }],
    };
  }
  if (tab === 'approved') {
    return { main: null, menu: [{ label: 'Suspender', run: () => handlers.onSuspend(row) }] };
  }
  return { main: null, menu: [] };
}
