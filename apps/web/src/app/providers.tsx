import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { basePath } from '@/shared/config/env';
import { loginPathFor, safeNextPath } from '@/features/auth/model/next-path';
import { setUnauthorizedHandler } from '@/shared/api/http-client';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { router } from './router';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Un 401 en cualquier petición: sesión cerrada o vencida. Se limpia la caché y se va a /login; al
  // salir de las rutas protegidas se desmonta `RealtimeProvider` y se cierra el socket.
  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        queryClient.clear();
        const { pathname, search, hash } = router.state.location;
        const currentPath = safeNextPath(`${pathname}${search}${hash}`, basePath) ?? '/';
        const routePath = currentPath.split(/[?#]/)[0]!;
        if (routePath === '/login' || routePath.startsWith('/invite/')) return;
        void router.navigate(loginPathFor(currentPath), { replace: true });
      }),
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
