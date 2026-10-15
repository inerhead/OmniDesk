import type { TenantState } from '../../tenancy/domain/tenant-state';

/** Persona que pidió el alta; en una empresa aprobada, su Owner más antiguo. */
export interface PlatformRequester {
  userId: string | null;
  displayName: string;
  email: string;
}

/** Empresa vista desde `/platform` (SPEC 18). */
export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  approval: 'PENDING' | 'APPROVED';
  state: TenantState;
  requester: PlatformRequester | null;
  contactPhone: string | null;
  contactEmail: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
}
