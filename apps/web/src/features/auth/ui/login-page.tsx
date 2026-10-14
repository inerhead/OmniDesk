import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { basePath } from '@/shared/config/env';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { fetchAuthProviders, postDevLogin } from '../api/auth-api';
import { resetSessionCache } from '../api/use-session-actions';
import { DEFAULT_NEXT_PATH, safeNextPath } from '../model/next-path';
import { ROLE_LABEL } from '../model/role-label';
import { AuthCard } from './auth-card';
import { GoogleButton } from './google-button';

const ERROR_MESSAGE: Record<string, string> = {
  oauth: 'No se pudo completar el login con Google. Inténtalo de nuevo.',
  email: 'Tu cuenta de Google no tiene un email verificado.',
};

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), basePath) ?? DEFAULT_NEXT_PATH;
  const error = ERROR_MESSAGE[params.get('error') ?? ''];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: fetchAuthProviders });

  const devLogin = useMutation({
    mutationFn: postDevLogin,
    onSuccess: (me) => {
      resetSessionCache(queryClient, me);
      void navigate(next, { replace: true });
    },
  });

  return (
    <AuthCard title="Entra en OmniDesk" description="Supervisa las conversaciones de tu empresa.">
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {providers.isPending && <Skeleton className="h-9 w-full" />}
      {providers.isError && (
        <p className="text-muted-foreground text-center text-sm">
          No se pudo conectar con el servidor.{' '}
          <button type="button" className="underline" onClick={() => void providers.refetch()}>
            Reintentar
          </button>
        </p>
      )}

      {providers.data?.google && <GoogleButton next={next} />}

      {providers.data && providers.data.demoMembers.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="dev-login">
          <h2
            id="dev-login"
            className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
          >
            Login de desarrollo
          </h2>
          {providers.data.demoMembers.map((member) => (
            <Button
              key={member.memberId}
              variant="secondary"
              className="h-auto w-full justify-start py-2"
              disabled={devLogin.isPending}
              onClick={() => devLogin.mutate(member.memberId)}
            >
              <Avatar
                id={member.memberId}
                name={member.displayName}
                fallback="?"
                imageUrl={member.avatarUrl}
                size="sm"
              />
              <span className="flex flex-col items-start">
                <span>Entrar como {member.displayName}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {ROLE_LABEL[member.role]}
                </span>
              </span>
            </Button>
          ))}
          {devLogin.isError && (
            <p role="alert" className="text-destructive text-sm">
              No se pudo iniciar sesión. Inténtalo de nuevo.
            </p>
          )}
        </section>
      )}

      {providers.data && !providers.data.google && providers.data.demoMembers.length === 0 && (
        <p className="text-muted-foreground text-center text-sm">
          No hay ningún método de login configurado.
        </p>
      )}
    </AuthCard>
  );
}
