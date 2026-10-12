import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiHttpError } from '@/shared/api/http-client';
import { backupPollingInterval, useConnectionStatus } from '@/shared/realtime/connection-status';
import { fetchConversations, fetchMessages } from './conversations-api';

export function useConversations() {
  // Con el socket conectado los eventos invalidan la query; si no, hay un polling de respaldo.
  const connection = useConnectionStatus();
  return useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: ({ pageParam }) => fetchConversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: backupPollingInterval(connection),
    refetchIntervalInBackground: false,
  });
}

/** Páginas de la más reciente a la más antigua; `fetchNextPage` trae mensajes anteriores. */
export function useMessages(conversationId: string) {
  const connection = useConnectionStatus();
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => fetchMessages(conversationId, pageParam),
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
