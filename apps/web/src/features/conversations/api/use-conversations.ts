import { type Inbox } from '@omnidesk/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCurrentActor } from '@/features/auth/api/use-current-actor';
import { ApiHttpError } from '@/shared/api/http-client';
import { backupPollingInterval, useConnectionStatus } from '@/shared/realtime/connection-status';
import {
  fetchConversation,
  fetchConversations,
  fetchInboxChannels,
  fetchTimeline,
} from './conversations-api';

// Con el socket conectado los eventos invalidan las queries; si no, hay un polling de respaldo.
// Las claves empiezan por 'conversations' / 'timeline' para que `RealtimeProvider` las invalide por prefijo.

export const conversationDetailKey = (actorId: string | undefined, conversationId: string) =>
  ['conversations', actorId, 'detail', conversationId] as const;

/** Canales que el miembro puede atender. No incluye secretos. */
export function useInboxChannels() {
  const { actor } = useCurrentActor();
  return useQuery({
    queryKey: ['inbox-channels', actor?.id],
    queryFn: fetchInboxChannels,
    enabled: actor !== null,
  });
}

/** `q` ya normalizado (`normalizeSearch`); sin `q`, la bandeja completa. */
export function useConversations(
  inbox: Inbox,
  q: string | undefined,
  channelId: string | undefined,
) {
  const { actor } = useCurrentActor();
  const connection = useConnectionStatus();
  return useInfiniteQuery({
    queryKey: ['conversations', actor?.id, 'list', inbox, q ?? '', channelId ?? ''],
    queryFn: ({ pageParam }) => fetchConversations(inbox, q, channelId, pageParam),
    enabled: actor !== null,
    // Al escribir en el buscador se mantiene la lista anterior hasta tener resultados; al cambiar
    // de bandeja, canal o actor, no: se ven los skeletons.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === actor?.id &&
      previousQuery?.queryKey[3] === inbox &&
      previousQuery?.queryKey[5] === (channelId ?? '')
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
    queryFn: () => fetchConversation(conversationId),
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
    queryFn: ({ pageParam }) => fetchTimeline(conversationId, pageParam),
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
