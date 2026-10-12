import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { realtimeTarget } from '@/shared/config/env';
import { connectRealtime } from '@/shared/realtime/realtime-client';

/** Conecta el socket e invalida las queries afectadas por cada evento (el contenido se pide por REST). */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      connectRealtime(realtimeTarget(), {
        onEvent: (event) => {
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          void queryClient.invalidateQueries({ queryKey: ['timeline', event.conversationId] });
        },
        onResync: () => void queryClient.invalidateQueries(),
      }),
    [queryClient],
  );

  return children;
}
