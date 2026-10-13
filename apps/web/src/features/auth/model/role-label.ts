import type { Membership } from '@omnidesk/contracts';

export const ROLE_LABEL: Record<Membership['role'], string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  AGENT: 'Agente',
};
