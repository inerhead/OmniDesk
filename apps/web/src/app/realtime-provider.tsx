import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { fetchMe } from '@/features/auth/api/auth-api';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { resetSessionCache } from '@/features/auth/api/use-session-actions';
import { markConversationDeleted } from '@/features/conversations/model/deleted-conversations';
import { realtimeTarget } from '@/shared/config/env';
import { connectRealtime } from '@/shared/realtime/realtime-client';

/** Conecta el socket e invalida las queries afectadas por cada evento (el contenido se pide por REST). */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(
    () =>
      connectRealtime(realtimeTarget(), {
        onEvent: (event) => {
          // Contacto borrado (SPEC 12): el chat abierto lo avisa y la lista se refresca sin ella.
          if (event.reason === 'deleted') markConversationDeleted(event.conversationId);
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          void queryClient.invalidateQueries({ queryKey: ['timeline', event.conversationId] });
        },
        onResync: () => void queryClient.invalidateQueries(),
        // Empresa inactivada o reactivada (SPEC 16): `/me` dice si la sesión sigue en ella. Admin y
        // Agent salen al momento (a otra empresa o a /onboarding); el OWNER se queda para reactivarla.
        onTenantStatus: () => {
          const previous = queryClient.getQueryData<{ activeTenantId: string | null }>(
            ME_QUERY_KEY,
          )?.activeTenantId;
          void fetchMe()
            .then((me) => {
              if (me.activeTenantId === previous) {
                queryClient.setQueryData(ME_QUERY_KEY, me);
                void queryClient.invalidateQueries({
                  predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0],
                });
                return;
              }
              resetSessionCache(queryClient, me);
              void navigate(me.activeTenantId ? '/conversations' : '/onboarding', {
                replace: true,
              });
            })
            .catch(() => void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }));
        },
      }),
    [queryClient, navigate],
  );

  return children;
}
