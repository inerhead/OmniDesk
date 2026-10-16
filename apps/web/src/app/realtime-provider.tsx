import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { fetchMe } from '@/features/auth/api/auth-api';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { resetSessionCache } from '@/features/auth/api/use-session-actions';
import { markConversationDeleted } from '@/features/conversations/model/deleted-conversations';
import {
  isConversationsPath,
  signalInbound,
} from '@/features/conversations/model/new-message-signal';
import { realtimeTarget } from '@/shared/config/env';
import { connectRealtime } from '@/shared/realtime/realtime-client';

/**
 * Conecta el socket e invalida las queries afectadas por cada evento (el contenido se pide por REST).
 * `enabled = false` no conecta: la empresa activa está en revisión o suspendida (SPEC 18).
 */
export function RealtimeProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // La ruta se lee en cada evento sin reconectar el socket al navegar.
  const pathname = useLocation().pathname;
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!enabled) return;
    return connectRealtime(realtimeTarget(), {
      onEvent: (event) => {
        // Contacto borrado (SPEC 12): el chat abierto lo avisa y la lista se refresca sin ella.
        if (event.reason === 'deleted') markConversationDeleted(event.conversationId);
        // Mensaje de un cliente (SPEC 21): aviso en el icono de Conversaciones.
        if (event.inbound) signalInbound(isConversationsPath(pathnameRef.current));
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['timeline', event.conversationId] });
      },
      onResync: () => void queryClient.invalidateQueries(),
      // Empresa inactivada o reactivada (SPEC 16), o suspendida por la plataforma (SPEC 18): `/me`
      // dice si la sesión sigue en ella. Admin y Agent salen al momento de una inactiva (a otra
      // empresa o a /onboarding) y el OWNER se queda para reactivarla; de una suspendida salen todos
      // a otra empresa, o se quedan viendo el aviso si no tienen otra.
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
    });
  }, [enabled, queryClient, navigate]);

  return children;
}
