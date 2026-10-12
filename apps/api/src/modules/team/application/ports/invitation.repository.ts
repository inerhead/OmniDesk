import type { InvitableRole, InvitationLifecycle } from '../../domain/team-policy';

export interface Invitation extends InvitationLifecycle {
  id: string;
  tenantId: string;
  email: string;
  role: InvitableRole;
  createdAt: Date;
  invitedBy: { id: string; displayName: string };
}

export interface InvitationWithTenant extends Invitation {
  tenantName: string;
}

export interface InvitationRepository {
  create(data: {
    tenantId: string;
    email: string;
    role: InvitableRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<Invitation>;
  /** Pendientes de la empresa, de la más reciente a la más antigua. */
  listPending(tenantId: string, now: Date): Promise<Invitation[]>;
  findById(tenantId: string, id: string): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<InvitationWithTenant | null>;
  /** Marca como usada solo si sigue pendiente (un solo uso, también con dos aceptaciones a la vez). */
  markAccepted(id: string, at: Date): Promise<boolean>;
  revoke(id: string, at: Date): Promise<void>;
}

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');
