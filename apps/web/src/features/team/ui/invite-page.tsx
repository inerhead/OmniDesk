import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { fetchAuthProviders, fetchMe } from '@/features/auth/api/auth-api';
import { resetSessionCache, useLogout } from '@/features/auth/api/use-session-actions';
import { ROLE_LABEL } from '@/features/auth/model/role-label';
import { AuthCard } from '@/features/auth/ui/auth-card';
import { GoogleButton } from '@/features/auth/ui/google-button';
import { ApiCodeError, isStatus } from '@/shared/api/api-error';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { TenantMark } from '@/shared/ui/tenant-mark';
import { fetchInvitationPreview, postAcceptInvitation } from '../api/team-api';

function acceptErrorMessage(error: unknown, emailMasked: string): string {
  if (error instanceof ApiCodeError) {
    if (error.code === 'INVITATION_EMAIL_MISMATCH') {
      return `Esta invitación es para ${emailMasked}. Entra con esa cuenta de Google.`;
    }
    if (error.code === 'ALREADY_MEMBER') return 'Ya eres miembro de esta empresa.';
    if (error.code === 'INVITATION_EXPIRED') return 'La invitación ya no es válida.';
    if (error.code === 'TENANT_INACTIVE') return 'Esta empresa está inactiva.';
  }
  return 'No se pudo aceptar la invitación. Inténtalo de nuevo.';
}

/** `/invite/:token`: pública. Sin sesión invita a entrar; con sesión, "Unirme". */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const next = `/invite/${token}`;

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => fetchInvitationPreview(token),
    retry: (count, error) => !isStatus(error, 404) && count < 2,
  });
  // Aquí un 401 es normal (aún sin sesión): no dispara la redirección global.
  const me = useQuery({
    queryKey: ['me-optional'],
    queryFn: () => fetchMe({ allowUnauthorized: true }),
    retry: false,
  });
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: fetchAuthProviders,
    enabled: isStatus(me.error, 401),
  });

  const accept = useMutation({
    mutationFn: () => postAcceptInvitation(token),
    onSuccess: async () => {
      resetSessionCache(queryClient, await fetchMe());
      void navigate('/conversations', { replace: true });
    },
  });

  if (preview.isPending || me.isPending) {
    return (
      <AuthCard title="Invitación">
        <Skeleton className="h-9 w-full" />
      </AuthCard>
    );
  }

  if (preview.isError || preview.data.expired) {
    return (
      <AuthCard
        title="Invitación no válida"
        description="El enlace venció, ya se usó o fue revocado. Pide a tu empresa uno nuevo."
      >
        <Button asChild variant="outline">
          <Link to="/conversations">Ir a OmniDesk</Link>
        </Button>
      </AuthCard>
    );
  }

  const { tenantName, role, emailMasked, tenantLogoUrl } = preview.data;
  const mark = <TenantMark id={token} name={tenantName} logoUrl={tenantLogoUrl} size="md" />;
  const description = (
    <>
      Te invitaron a <strong className="text-foreground">{tenantName}</strong> como{' '}
      {ROLE_LABEL[role]}. La invitación es para {emailMasked}.
    </>
  );

  if (!me.data) {
    return (
      <AuthCard title={`Únete a ${tenantName}`} description={description} mark={mark}>
        {providers.data?.google ? (
          <GoogleButton next={next} label={`Entrar con Google para unirte a ${tenantName}`} />
        ) : (
          <Button asChild>
            <Link to={`/login?${new URLSearchParams({ next })}`}>Entrar para unirte</Link>
          </Button>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Únete a ${tenantName}`} description={description} mark={mark}>
      <p className="text-muted-foreground text-center text-sm">
        Entraste como <span className="text-foreground">{me.data.user.email}</span>
      </p>
      {accept.isError && (
        <p role="alert" className="text-destructive text-sm">
          {acceptErrorMessage(accept.error, emailMasked)}
        </p>
      )}
      <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
        Unirme
      </Button>
      <button
        type="button"
        className="text-muted-foreground text-sm underline"
        onClick={() => logout.mutate()}
      >
        Entrar con otra cuenta
      </button>
    </AuthCard>
  );
}
