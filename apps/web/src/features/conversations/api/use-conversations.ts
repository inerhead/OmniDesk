import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiHttpError } from '@/shared/api/http-client';
import { fetchConversations, fetchMessages } from './conversations-api';

/** Temporal hasta el SPEC 03 (tiempo real): refresco cada 5 s, solo con la pestaña visible. */
export const POLLING_INTERVAL_MS = 5_000;

export function useConversations() {
  return useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: ({ pageParam }) => fetchConversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: POLLING_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Páginas de la más reciente a la más antigua; `fetchNextPage` trae mensajes anteriores. */
export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => fetchMessages(conversationId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.prevCursor ?? undefined,
    refetchInterval: (query) => (isNotFound(query.state.error) ? false : POLLING_INTERVAL_MS),
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 2,
  });
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 404;
}
