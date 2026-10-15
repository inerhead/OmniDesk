import { E164Schema, TenantSlugSchema } from '@omnidesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiCodeError } from '@/shared/api/api-error';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { fetchMe, postTenant } from '../api/auth-api';
import { activeMembership, useMe } from '../api/use-me';
import { resetSessionCache, useLogout } from '../api/use-session-actions';
import { slugify } from '../model/slugify';
import { hasPendingRequest, waitsInOnboarding } from '../model/tenant-request';
import { canCreateTenant } from '../model/tenant-permissions';
import { AuthCard } from './auth-card';
import { PendingRequestBody, RejectedRequestBody } from './tenant-request-screens';

/**
 * Alta de empresa (SPEC 07 y 18). Según `/me` muestra:
 * - la espera, si su única empresa está en revisión (se actualiza sola al aprobarse);
 * - el rechazo con su motivo, sin empresas, hasta que envía otra solicitud;
 * - el formulario: nombre, identificador y móvil de contacto. La empresa queda en revisión.
 * Sin `?create`, quien ya tiene empresa vuelve a la bandeja, y un admin de plataforma sin empresas va
 * a `/platform`. Si no puede crear (solo es AGENT o ADMIN), también vuelve a la bandeja.
 */
export function OnboardingPage() {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const logout = useLogout();
  const [retrying, setRetrying] = useState(false);
  const explicit = params.has('create');
  const membership = activeMembership(me);

  if (me && !explicit) {
    if (membership && !waitsInOnboarding(me)) return <Navigate to="/conversations" replace />;
    if (me.isPlatformAdmin && me.memberships.length === 0 && !me.tenantRejection) {
      return <Navigate to="/platform" replace />;
    }
  }
  if (me && (!canCreateTenant(me) || (explicit && hasPendingRequest(me)))) {
    return <Navigate to="/conversations" replace />;
  }

  const footer = (
    <div className="text-muted-foreground flex justify-center gap-4 text-sm">
      <button type="button" className="underline" onClick={() => logout.mutate()}>
        Cerrar sesión
      </button>
    </div>
  );

  if (membership && waitsInOnboarding(me)) {
    return (
      <AuthCard title="Tu empresa está en camino">
        <PendingRequestBody membership={membership} />
        {footer}
      </AuthCard>
    );
  }
  if (me?.tenantRejection && me.memberships.length === 0 && !retrying) {
    return (
      <AuthCard title="Solicitud rechazada">
        <RejectedRequestBody rejection={me.tenantRejection} />
        <Button type="button" onClick={() => setRetrying(true)}>
          Enviar otra solicitud
        </Button>
        {footer}
      </AuthCard>
    );
  }
  return <CreateTenantForm hasMemberships={Boolean(me?.memberships.length)} footer={footer} />;
}

function CreateTenantForm({
  hasMemberships,
  footer,
}: {
  hasMemberships: boolean;
  footer: ReactNode;
}) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [phone, setPhone] = useState('');
  const effectiveSlug = slugEdited ? slug : slugify(name);
  const slugValid = TenantSlugSchema.safeParse(effectiveSlug).success;
  const contactPhone = phone.replace(/[\s()-]/g, '');
  const phoneValid = E164Schema.safeParse(contactPhone).success;
  const valid = name.trim().length >= 2 && slugValid && phoneValid;

  const create = useMutation({
    mutationFn: postTenant,
    onSuccess: async () => {
      resetSessionCache(queryClient, await fetchMe());
      // En revisión: la bandeja lleva a la espera (en `/onboarding` si no tiene otras empresas).
      void navigate('/conversations', { replace: true });
    },
  });
  const slugTaken = create.error instanceof ApiCodeError && create.error.code === 'SLUG_TAKEN';
  const requestPending =
    create.error instanceof ApiCodeError && create.error.code === 'REQUEST_PENDING';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    create.mutate({ name: name.trim(), slug: effectiveSlug, contactPhone });
  };

  return (
    <AuthCard
      title="Crea tu empresa"
      description={
        hasMemberships
          ? 'Crea otra empresa; podrás cambiar entre ellas desde el menú de empresa.'
          : 'Todavía no perteneces a ninguna empresa. Pide la tuya o abre el enlace de invitación que te compartieron.'
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nombre de la empresa
          <Input
            value={name}
            autoFocus
            maxLength={80}
            placeholder="Acme S.A.S."
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Identificador
          <Input
            value={effectiveSlug}
            maxLength={40}
            placeholder="acme"
            aria-invalid={slugTaken || (effectiveSlug.length > 0 && !slugValid)}
            aria-describedby="slug-help"
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value.toLowerCase());
            }}
          />
          <span
            id="slug-help"
            className={
              slugTaken ? 'text-destructive text-xs' : 'text-muted-foreground text-xs font-normal'
            }
          >
            {slugTaken
              ? 'Ese identificador ya está en uso. Prueba con otro.'
              : 'Minúsculas, números y guiones; entre 3 y 40 caracteres.'}
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Teléfono móvil
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            maxLength={20}
            placeholder="+573001234567"
            aria-invalid={phone.length > 0 && !phoneValid}
            aria-describedby="phone-help"
            onChange={(event) => setPhone(event.target.value)}
          />
          <span id="phone-help" className="text-muted-foreground text-xs font-normal">
            Con el prefijo del país (+57…). La plataforma lo usa para contactarte.
          </span>
        </label>
        {me && (
          <p className="text-muted-foreground text-xs">
            Email de contacto: <span className="text-foreground">{me.user.email}</span> (el de tu
            cuenta).
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          La plataforma revisa cada empresa nueva antes de activarla.
        </p>
        {requestPending && (
          <p role="alert" className="text-destructive text-sm">
            Ya tienes una solicitud de empresa en revisión.
          </p>
        )}
        {create.isError && !slugTaken && !requestPending && (
          <p role="alert" className="text-destructive text-sm">
            No se pudo enviar la solicitud. Inténtalo de nuevo.
          </p>
        )}
        <Button type="submit" disabled={create.isPending || !valid}>
          {create.isPending ? 'Enviando…' : 'Enviar solicitud'}
        </Button>
      </form>
      {me?.activeTenantId && (
        <div className="text-muted-foreground flex justify-center text-sm">
          <button type="button" className="underline" onClick={() => void navigate(-1)}>
            Volver
          </button>
        </div>
      )}
      {footer}
    </AuthCard>
  );
}
