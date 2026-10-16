import type { PlatformTenantStatus } from '@omnidesk/contracts';
import { cn } from '@/shared/lib/utils';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
export const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '—');

/**
 * Columnas fijas de cada pestaña (SPEC 21), iguales en el encabezado y en todas las filas. Acciones
 * conserva su ancho aunque una fila no tenga ninguna. Estado solo existe en Aprobadas.
 */
export const TENANT_GRID: Record<PlatformTenantStatus, string> = {
  pending: 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(6rem,7rem)_12rem]',
  approved:
    'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(6rem,7rem)_6.5rem_12rem]',
  rejected:
    'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(6rem,7rem)_12rem]',
};

export const DELETION_GRID =
  'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(6rem,7rem)_9rem_minmax(0,1.6fr)]';

export function tenantColumns(tab: PlatformTenantStatus): string[] {
  const date = { pending: 'Pedida', approved: 'Aprobada', rejected: 'Rechazada' }[tab];
  return [
    'Empresa',
    tab === 'approved' ? 'Owner' : 'Solicitante',
    'Contacto',
    date,
    ...(tab === 'approved' ? ['Estado'] : []),
    'Acciones',
  ];
}

export const DELETION_COLUMNS = ['Empresa', 'Borrada por', 'Pedida el', 'Estado', 'Conteos'];

/** Celdas de una fila: misma rejilla en ≥ md; en móvil se apilan. */
export function rowGridClass(grid: string): string {
  return cn('flex flex-col gap-2 px-4 py-4 md:grid md:items-center md:gap-4', grid);
}
