import type { Membership, MeResponse } from '@omnidesk/contracts';
import { useQuery } from '@tanstack/react-query';
import { isStatus } from '@/shared/api/api-error';
import { fetchMe } from './auth-api';

export const ME_QUERY_KEY = ['me'] as const;

/** Usuario de la sesión. Un `401` lo maneja el interceptor global (redirige a `/login`). */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => fetchMe(),
    staleTime: 60_000,
    retry: (failureCount, error) => !isStatus(error, 401) && failureCount < 2,
  });
}

export function activeMembership(me: MeResponse | undefined): Membership | null {
  return me?.memberships.find((membership) => membership.tenantId === me.activeTenantId) ?? null;
}

export const isManagerRole = (role: Membership['role']) => role === 'OWNER' || role === 'ADMIN';
