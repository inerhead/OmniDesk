import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { loginPathFor } from '@/features/auth/model/next-path';
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
        const { pathname, search } = router.state.location;
        if (pathname.startsWith('/login') || pathname.startsWith('/invite/')) return;
        void router.navigate(loginPathFor(`${pathname}${search}`), { replace: true });
      }),
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
