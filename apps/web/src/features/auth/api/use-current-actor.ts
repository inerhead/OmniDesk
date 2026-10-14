import type { Member } from '@omnidesk/contracts';
import { useQuery } from '@tanstack/react-query';
import { fetchMembers } from './auth-api';
import { activeMembership, useMe } from './use-me';

export interface CurrentActor {
  /** Membresía de la sesión en la empresa activa; `null` mientras carga. */
  actor: Member | null;
  /** Miembros activos de la empresa activa ("Asignar a…"). */
  members: Member[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

export function useMembers(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['members', tenantId],
    queryFn: fetchMembers,
    enabled: tenantId !== undefined,
  });
}

/** Con quién actúa la web: el usuario de la sesión en su empresa activa. */
export function useCurrentActor(): CurrentActor {
  const me = useMe();
  const membership = activeMembership(me.data);
  const members = useMembers(membership?.tenantId);
  const list = members.data?.items ?? [];

  const actor: Member | null = membership
    ? (list.find((member) => member.id === membership.memberId) ?? {
        id: membership.memberId,
        displayName: me.data!.user.displayName,
        role: membership.role,
        avatarUrl: me.data!.user.avatarUrl,
      })
    : null;

  return {
    actor,
    members: list,
    isLoading: me.isPending || (membership !== null && members.isPending),
    isError: me.isError || members.isError,
    retry: () => {
      void me.refetch();
      void members.refetch();
    },
  };
}
