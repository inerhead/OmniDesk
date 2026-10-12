import { type Inbox } from '@omnidesk/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCurrentActor } from '@/features/actor/api/use-actor';
import { ApiHttpError } from '@/shared/api/http-client';
import { backupPollingInterval, useConnectionStatus } from '@/shared/realtime/connection-status';
import { fetchConversation, fetchConversations, fetchTimeline } from './conversations-api';

// Con el socket conectado los eventos invalidan las queries; si no, hay un polling de respaldo.
// Las claves empiezan por 'conversations' / 'timeline' para que `RealtimeProvider` las invalide por prefijo.

export const conversationDetailKey = (actorId: string | undefined, conversationId: string) =>
  ['conversations', actorId, 'detail', conversationId] as const;

/** `q` ya normalizado (`normalizeSearch`); sin `q`, la bandeja completa. */
export function useConversations(inbox: Inbox, q: string | undefined) {
  const { actor } = useCurrentActor();
  const connection = useConnectionStatus();
  return useInfiniteQuery({
    queryKey: ['conversations', actor?.id, 'list', inbox, q ?? ''],
    queryFn: ({ pageParam }) => fetchConversations(actor!.id, inbox, q, pageParam),
    enabled: actor !== null,
    // Al escribir en el buscador se mantiene la lista anterior hasta tener resultados; al cambiar
    // de bandeja o de actor, no: se ven los skeletons.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === actor?.id && previousQuery?.queryKey[3] === inbox
        ? previous
        : undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: backupPollingInterval(connection),
    refetchIntervalInBackground: false,
  });
}

/** Estado actual de una conversación (agente, `controlVersion`): sale de cualquier bandeja. */
export function useConversation(conversationId: string) {
  const { actor } = useCurrentActor();
  const connection = useConnectionStatus();
  return useQuery({
    queryKey: conversationDetailKey(actor?.id, conversationId),
    queryFn: () => fetchConversation(actor!.id, conversationId),
    enabled: actor !== null,
    refetchInterval: (query) =>
      isNotFound(query.state.error) ? false : backupPollingInterval(connection),
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 2,
  });
}

/** Páginas de la más reciente a la más antigua; `fetchNextPage` trae elementos anteriores. */
export function useTimeline(conversationId: string) {
  const { actor } = useCurrentActor();
  const connection = useConnectionStatus();
  return useInfiniteQuery({
    queryKey: ['timeline', conversationId, actor?.id],
    queryFn: ({ pageParam }) => fetchTimeline(actor!.id, conversationId, pageParam),
    enabled: actor !== null,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.prevCursor ?? undefined,
    refetchInterval: (query) =>
      isNotFound(query.state.error) ? false : backupPollingInterval(connection),
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 2,
  });
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 404;
}
