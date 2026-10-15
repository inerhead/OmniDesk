import { TenantSlugSchema, type TenantDetails } from '@omnidesk/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, PowerOff, ShieldOff, Trash2 } from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { ME_QUERY_KEY, activeMembership, useMe } from '@/features/auth/api/use-me';
import { ApiCodeError } from '@/shared/api/api-error';
import { ApiHttpError } from '@/shared/api/http-client';
import { checkImageSource, readAsDataUrl } from '@/shared/lib/crop-to-blob';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { TenantMark } from '@/shared/ui/tenant-mark';
import {
  COMPANY_QUERY_KEY,
  deactivateCompany,
  deleteCompanyLogo,
  fetchCompany,
  patchCompany,
  putCompanyLogo,
  reactivateCompany,
} from './company-api';
import { DeactivateDialog } from './deactivate-dialog';

const loadCropDialog = () => import('@/shared/ui/image-crop-dialog');
const ImageCropDialog = lazy(loadCropDialog);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });

const SOURCE_NOTICE = {
  unsupported: 'Elige una imagen JPEG, PNG o WebP.',
  'too-large': 'La imagen supera 10 MB. Elige una más pequeña.',
} as const;

function saveNotice(error: unknown): string {
  if (error instanceof ApiCodeError && error.code === 'SLUG_TAKEN')
    return 'Ese identificador ya está en uso.';
  if (error instanceof ApiCodeError && error.code === 'DEMO_SLUG_LOCKED')
    return 'La empresa demo conserva su identificador.';
  return 'No se pudieron guardar los cambios. Inténtalo de nuevo.';
}

function logoNotice(error: unknown): string {
  if (error instanceof ApiHttpError && error.status === 413) return 'El logo es demasiado grande.';
  if (error instanceof ApiHttpError && error.status === 415)
    return 'El formato del logo no es válido.';
  return 'No se pudo guardar el logo. Inténtalo de nuevo.';
}

/**
 * `/settings/company` (solo Owner): datos, logo e inactivación de la empresa activa. Con la empresa
 * inactiva solo muestra el aviso y "Reactivar" (SPEC 16).
 */
export function CompanyPage() {
  const { data: me } = useMe();
  const membership = activeMembership(me);
  const isOwner = membership?.role === 'OWNER';
  const company = useQuery({
    queryKey: [...COMPANY_QUERY_KEY, membership?.tenantId],
    queryFn: fetchCompany,
    enabled: isOwner,
  });

  if (!me || (isOwner && company.isPending)) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!isOwner || !company.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={ShieldOff}
          title="No tienes acceso"
          description="Solo los Owner gestionan los datos de la empresa."
        />
      </div>
    );
  }
  return company.data.deactivatedAt ? (
    <InactiveCompany company={company.data} />
  ) : (
    <ActiveCompany company={company.data} />
  );
}

/** Tras un cambio: la caché de la empresa y `/me` (selector, rail). */
function useApplyCompany() {
  const queryClient = useQueryClient();
  return async (company: TenantDetails) => {
    queryClient.setQueryData([...COMPANY_QUERY_KEY, company.id], company);
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  };
}

function InactiveCompany({ company }: { company: TenantDetails }) {
  const applyCompany = useApplyCompany();
  const [notice, setNotice] = useState<string | null>(null);
  const reactivate = useMutation({
    mutationFn: reactivateCompany,
    onSuccess: applyCompany,
    onError: () => setNotice('No se pudo reactivar. Inténtalo de nuevo.'),
  });
  const by = company.deactivatedBy?.displayName ?? 'un Owner';
  const when = dateFormat.format(new Date(company.deactivatedAt!));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <TenantMark id={company.id} name={company.name} logoUrl={company.logoUrl} size="md" />
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate">{company.name} está inactiva</CardTitle>
            <CardDescription>
              Inactivada por {by} el {when}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Los mensajes de WhatsApp se siguen guardando, sin IA ni notificaciones. Admin y Agent no
            tienen acceso y no sale ningún mensaje. Al reactivarla, se reenvían los mensajes
            cortados que aún están dentro de la ventana de 18 h.
          </p>
          <Button
            type="button"
            className="self-start"
            disabled={reactivate.isPending}
            onClick={() => reactivate.mutate()}
          >
            {reactivate.isPending ? 'Reactivando…' : 'Reactivar'}
          </Button>
          {notice && (
            <p role="status" className="text-destructive text-sm">
              {notice}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ActiveCompany({ company }: { company: TenantDetails }) {
  // El recorte se descarga al abrir la página, no en el bundle inicial ni al elegir el logo.
  useEffect(() => {
    void loadCropDialog();
  }, []);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-4">
      <CompanyData company={company} />
      <CompanyLogo company={company} />
      <DangerZone company={company} />
    </div>
  );
}

function CompanyData({ company }: { company: TenantDetails }) {
  const applyCompany = useApplyCompany();
  const [name, setName] = useState(company.name);
  const [slug, setSlug] = useState(company.slug);
  const [notice, setNotice] = useState<string | null>(null);
  const nameValid = name.trim().length >= 2 && name.trim().length <= 80;
  const slugValid = TenantSlugSchema.safeParse(slug).success;
  const changed = name.trim() !== company.name || slug !== company.slug;

  const save = useMutation({
    mutationFn: patchCompany,
    onSuccess: async (next) => {
      setNotice('Cambios guardados.');
      await applyCompany(next);
    },
    onError: (error) => setNotice(saveNotice(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid || !slugValid || !changed) return;
    save.mutate({
      ...(name.trim() !== company.name && { name: name.trim() }),
      ...(slug !== company.slug && { slug }),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Empresa</CardTitle>
        <CardDescription>El nombre se ve en el selector de empresas y en el rail.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Nombre
            <Input
              value={name}
              maxLength={80}
              aria-invalid={!nameValid}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Identificador (slug)
            <Input
              value={slug}
              disabled={company.slugLocked}
              aria-invalid={!slugValid}
              aria-describedby="company-slug-help"
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
            <span id="company-slug-help" className="text-muted-foreground text-xs font-normal">
              {company.slugLocked
                ? 'La empresa demo conserva su identificador.'
                : 'Solo minúsculas, números y guiones simples.'}
            </span>
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending || !changed || !nameValid || !slugValid}>
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
            {notice && (
              <p role="status" className="text-muted-foreground text-sm">
                {notice}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CompanyLogo({ company }: { company: TenantDetails }) {
  const applyCompany = useApplyCompany();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const upload = useMutation({
    mutationFn: putCompanyLogo,
    onSuccess: async (next) => {
      setSource(null);
      setNotice('Logo actualizado.');
      await applyCompany(next);
    },
    onError: (error) => setNotice(logoNotice(error)),
  });
  const remove = useMutation({
    mutationFn: deleteCompanyLogo,
    onSuccess: async (next) => {
      setNotice('Logo quitado.');
      await applyCompany(next);
    },
    onError: () => setNotice('No se pudo quitar el logo. Inténtalo de nuevo.'),
  });
  const busy = upload.isPending || remove.isPending;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Permite volver a elegir el mismo archivo.
    event.target.value = '';
    if (!file) return;
    const check = checkImageSource(file);
    if (check !== 'ok') {
      setNotice(SOURCE_NOTICE[check]);
      return;
    }
    setNotice(null);
    try {
      setSource(await readAsDataUrl(file));
    } catch {
      setNotice('No se pudo leer la imagen.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>Cuadrado; sin logo se muestran las iniciales.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
        <TenantMark id={company.id} name={company.name} logoUrl={company.logoUrl} size="lg" />
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
              <Camera aria-hidden />
              {company.logoUrl ? 'Cambiar logo' : 'Subir logo'}
            </Button>
            {company.logoUrl && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 aria-hidden />
                Quitar logo
              </Button>
            )}
          </div>
          {notice && (
            <p role="status" className="text-muted-foreground text-sm">
              {notice}
            </p>
          )}
          <input
            ref={input}
            type="file"
            // iOS convierte las fotos HEIC a JPEG al elegirlas con esta lista.
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => void pick(event)}
          />
        </div>
      </CardContent>

      {source !== null && (
        <Suspense fallback={null}>
          <ImageCropDialog
            key={source}
            source={source}
            shape="rect"
            title="Encuadra el logo"
            saving={upload.isPending}
            onCancel={() => setSource(null)}
            onSave={(image) => upload.mutate(image)}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title="Quitar logo"
        description="La empresa volverá a mostrarse con sus iniciales."
        confirmLabel="Quitar"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          setConfirmRemove(false);
          remove.mutate();
        }}
        onOpenChange={setConfirmRemove}
      />
    </Card>
  );
}

function DangerZone({ company }: { company: TenantDetails }) {
  const applyCompany = useApplyCompany();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deactivate = useMutation({
    mutationFn: deactivateCompany,
    onSuccess: async (next) => {
      setOpen(false);
      await applyCompany(next);
    },
    onError: (failure) =>
      setError(
        failure instanceof ApiCodeError && failure.code === 'CONFIRMATION_MISMATCH'
          ? 'El nombre no coincide.'
          : 'No se pudo inactivar. Inténtalo de nuevo.',
      ),
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Zona de peligro</CardTitle>
        <CardDescription>
          Inactivar corta la atención y el acceso de Admin y Agent. Los datos se conservan y puedes
          reactivarla después.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          className="border-destructive/50 text-destructive hover:text-destructive"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <PowerOff aria-hidden />
          Inactivar empresa
        </Button>
      </CardContent>
      <DeactivateDialog
        open={open}
        tenantName={company.name}
        pending={deactivate.isPending}
        error={error}
        onConfirm={(confirmName) => deactivate.mutate(confirmName)}
        onOpenChange={setOpen}
      />
    </Card>
  );
}
