import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { isStatus } from '@/shared/api/api-error';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { useMe } from '../api/use-me';

export function FullScreenLoader() {
  return (
    <div className="flex h-dvh items-center justify-center" aria-busy="true">
      <Loader2 className="text-muted-foreground size-6 animate-spin" aria-label="Cargando" />
    </div>
  );
}

/**
 * Protege las rutas de la app: consulta `GET /me`. Sin sesión, el interceptor de `401` ya redirige a
 * `/login?next=`; aquí solo se espera.
 */
export function AuthGate() {
  const me = useMe();
  if (me.isPending || isStatus(me.error, 401)) return <FullScreenLoader />;
  if (me.isError) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <EmptyState
          title="No se pudo conectar con el servidor"
          action={
            <Button size="sm" variant="outline" onClick={() => void me.refetch()}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }
  return <Outlet />;
}

/** Sin empresa activa (usuario nuevo) se va al alta de empresa. */
export function RequireActiveTenant({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me?.activeTenantId) return <Navigate to="/onboarding" replace />;
  return children;
}
