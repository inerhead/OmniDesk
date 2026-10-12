import { TenantSlugSchema } from '@omnidesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiCodeError } from '@/shared/api/api-error';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { fetchMe, postTenant } from '../api/auth-api';
import { useMe } from '../api/use-me';
import { resetSessionCache, useLogout } from '../api/use-session-actions';
import { slugify } from '../model/slugify';
import { AuthCard } from './auth-card';

/** "Crea tu empresa": quien la crea queda OWNER y pasa a ser su empresa activa. */
export function OnboardingPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const effectiveSlug = slugEdited ? slug : slugify(name);
  const slugValid = TenantSlugSchema.safeParse(effectiveSlug).success;

  const create = useMutation({
    mutationFn: postTenant,
    onSuccess: async () => {
      resetSessionCache(queryClient, await fetchMe());
      void navigate('/conversations', { replace: true });
    },
  });
  const slugTaken = create.error instanceof ApiCodeError && create.error.code === 'SLUG_TAKEN';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || !slugValid) return;
    create.mutate({ name: name.trim(), slug: effectiveSlug });
  };

  return (
    <AuthCard
      title="Crea tu empresa"
      description={
        me?.memberships.length
          ? 'Crea otra empresa; podrás cambiar entre ellas desde el menú de usuario.'
          : 'Todavía no perteneces a ninguna empresa. Crea la tuya o abre el enlace de invitación que te compartieron.'
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
        {create.isError && !slugTaken && (
          <p role="alert" className="text-destructive text-sm">
            No se pudo crear la empresa. Inténtalo de nuevo.
          </p>
        )}
        <Button type="submit" disabled={create.isPending || name.trim().length < 2 || !slugValid}>
          Crear empresa
        </Button>
      </form>
      <div className="text-muted-foreground flex justify-center gap-4 text-sm">
        {me?.activeTenantId && (
          <button type="button" className="underline" onClick={() => void navigate(-1)}>
            Volver
          </button>
        )}
        <button type="button" className="underline" onClick={() => logout.mutate()}>
          Cerrar sesión
        </button>
      </div>
    </AuthCard>
  );
}
