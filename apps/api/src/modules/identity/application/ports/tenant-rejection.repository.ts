/** Solicitud de empresa rechazada (SPEC 18): la empresa ya no existe, queda esta copia. */
export interface TenantRejection {
  id: string;
  userId: string;
  tenantName: string;
  tenantSlug: string;
  reason: string;
  contactPhone: string | null;
  contactEmail: string | null;
  requestedAt: Date;
  rejectedAt: Date;
}

/** Aviso de rechazo que el solicitante aún no ha cerrado. */
export interface OpenTenantRejection {
  tenantName: string;
  reason: string;
  rejectedAt: Date;
}

/**
 * Rechazos de solicitudes (SPEC 18). Sin `tenant_id` ni RLS: solo caminos de sistema (`/me`, el alta,
 * `/platform` y el job de retención).
 */
export interface TenantRejectionRepository {
  create(data: Omit<TenantRejection, 'id'> & { rejectedByUserId: string }): Promise<void>;
  /** El más reciente sin cerrar del usuario, o `null`. */
  findOpenForUser(userId: string): Promise<OpenTenantRejection | null>;
  /** Cierra los avisos abiertos del usuario (al cerrarlo o al enviar otra solicitud). */
  dismissForUser(userId: string, at: Date): Promise<void>;
  /** Rechazos desde `since`, el más reciente primero, con el nombre del solicitante. */
  listSince(
    since: Date,
  ): Promise<Array<TenantRejection & { requester: { displayName: string; email: string } }>>;
  /** Borra los rechazos anteriores a `cutoff` (retención, 20 días). Devuelve cuántos. */
  deleteRejectedBefore(cutoff: Date): Promise<number>;
}

export const TENANT_REJECTION_REPOSITORY = Symbol('TENANT_REJECTION_REPOSITORY');

/** Días que se conserva un rechazo (SPEC 18). */
export const TENANT_REJECTION_RETENTION_DAYS = 20;

export function tenantRejectionCutoff(now: Date): Date {
  return new Date(now.getTime() - TENANT_REJECTION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
