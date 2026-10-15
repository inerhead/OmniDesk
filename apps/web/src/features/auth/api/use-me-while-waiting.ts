import { useQuery } from '@tanstack/react-query';
import { fetchMe } from './auth-api';
import { ME_QUERY_KEY } from './use-me';

/** Cada cuánto se vuelve a pedir `/me` mientras se espera la revisión (SPEC 18). */
export const WAITING_REFRESH_MS = 30_000;

/**
 * `/me` cada 30 s y al recuperar el foco mientras se muestra la espera o la suspensión: así la app
 * entra sola cuando la plataforma decide. Comparte la caché de `useMe`.
 */
export function useMeWhileWaiting() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => fetchMe(),
    refetchInterval: WAITING_REFRESH_MS,
    refetchOnWindowFocus: 'always',
  });
}
