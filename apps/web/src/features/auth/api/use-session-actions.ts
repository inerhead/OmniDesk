import type { MeResponse } from '@omnidesk/contracts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { disablePushOnThisDevice } from '@/features/notifications/push-api';
import { postActiveTenant, postLogout } from './auth-api';
import { ME_QUERY_KEY } from './use-me';

/** Nueva sesión o nueva empresa activa: nada de la anterior debe seguir en caché. */
export function resetSessionCache(queryClient: QueryClient, me?: MeResponse): void {
  if (me) {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0] });
    queryClient.setQueryData(ME_QUERY_KEY, me);
  } else {
    queryClient.clear();
  }
}

/**
 * Cambia la empresa activa: borra la caché de la anterior y vuelve a la bandeja. El socket se
 * reconecta porque `RealtimeProvider` depende de la empresa activa.
 */
export function useSwitchTenant() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: postActiveTenant,
    onSuccess: (me) => {
      resetSessionCache(queryClient, me);
      void navigate('/conversations');
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      await disablePushOnThisDevice().catch(() => undefined);
      await postLogout();
    },
    onSettled: () => {
      resetSessionCache(queryClient);
      void navigate('/login', { replace: true });
    },
  });
}
