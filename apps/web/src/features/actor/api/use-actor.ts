import type { Member } from '@omnidesk/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { resolveActor } from '../model/resolve-actor';
import { setActorId, useStoredActorId } from '../model/actor-store';
import { fetchMembers } from './members-api';

export function useMembers() {
  return useQuery({ queryKey: ['members'], queryFn: fetchMembers });
}

export interface CurrentActor {
  /** `null` mientras se cargan los miembros. Las consultas de la bandeja esperan a que exista. */
  actor: Member | null;
  members: Member[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

/** Con quién actúa la web. Si no hay elección guardada, se elige "Sup. Demo" y se guarda. */
export function useCurrentActor(): CurrentActor {
  const members = useMembers();
  const storedId = useStoredActorId();
  const list = members.data?.items ?? [];
  const resolved = resolveActor(list, storedId);

  useEffect(() => {
    if (resolved && resolved.id !== storedId) setActorId(resolved.id);
  }, [resolved, storedId]);

  // Solo hay actor cuando coincide con lo guardado: así `X-Demo-Member-Id` nunca va con otro id.
  return {
    actor: resolved && resolved.id === storedId ? resolved : null,
    members: list,
    isLoading: members.isPending,
    isError: members.isError,
    retry: () => void members.refetch(),
  };
}
