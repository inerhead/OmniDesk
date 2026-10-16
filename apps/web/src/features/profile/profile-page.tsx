import { isUploadedAvatarUrl, type MeResponse } from '@omnidesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ME_QUERY_KEY, useMe } from '@/features/auth/api/use-me';
import { ApiHttpError } from '@/shared/api/http-client';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import {
  SettingsPage,
  SettingsSection,
  SettingsSectionSkeleton,
} from '@/shared/ui/settings-section';
import { checkImageSource, readAsDataUrl } from '@/shared/lib/crop-to-blob';
import { deleteAvatar, putAvatar } from './profile-api';

const loadCropDialog = () => import('@/shared/ui/image-crop-dialog');
const ImageCropDialog = lazy(loadCropDialog);

const SOURCE_NOTICE = {
  unsupported: 'Elige una imagen JPEG, PNG o WebP.',
  'too-large': 'La imagen supera 10 MB. Elige una más pequeña.',
} as const;

function uploadNotice(error: unknown): string {
  if (error instanceof ApiHttpError && error.status === 413) return 'La foto es demasiado grande.';
  if (error instanceof ApiHttpError && error.status === 415)
    return 'El formato de la foto no es válido.';
  return 'No se pudo guardar la foto. Inténtalo de nuevo.';
}

/**
 * `/settings/profile`: la foto del usuario (subir, cambiar o quitar) y su cuenta (nombre y email,
 * solo lectura), en secciones de dos columnas (SPEC 21).
 */
export function ProfilePage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // El recorte se descarga al abrir "Mi perfil", no en el bundle inicial ni al elegir la foto.
  useEffect(() => {
    void loadCropDialog();
  }, []);

  const applyUser = (user: MeResponse['user']) => {
    queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (current) =>
      current ? { ...current, user } : current,
    );
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['members'] }),
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
    ]);
  };

  const upload = useMutation({
    mutationFn: putAvatar,
    onSuccess: async (user) => {
      setSource(null);
      setNotice('Foto actualizada.');
      await applyUser(user);
    },
    onError: (error) => setNotice(uploadNotice(error)),
  });
  const remove = useMutation({
    mutationFn: deleteAvatar,
    onSuccess: async (user) => {
      setNotice('Foto quitada.');
      await applyUser(user);
    },
    onError: () => setNotice('No se pudo quitar la foto. Inténtalo de nuevo.'),
  });

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

  if (!me) {
    return (
      <SettingsPage title="Mi perfil" description="Tu cuenta en OmniDesk">
        <SettingsSectionSkeleton />
        <SettingsSectionSkeleton />
      </SettingsPage>
    );
  }

  const { user } = me;
  const uploaded = isUploadedAvatarUrl(user.avatarUrl);
  const busy = upload.isPending || remove.isPending;

  return (
    <SettingsPage title="Mi perfil" description="Tu cuenta en OmniDesk">
      <SettingsSection title="Foto" description="Tu foto se ve en todas tus empresas.">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <Avatar
            id={user.id}
            name={user.displayName}
            fallback={user.email}
            imageUrl={user.avatarUrl}
            size="lg"
            className="size-24 text-3xl"
          />
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
                <Camera aria-hidden />
                {uploaded ? 'Cambiar foto' : 'Subir foto'}
              </Button>
              {uploaded && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 aria-hidden />
                  Quitar foto
                </Button>
              )}
            </div>
            <input
              ref={input}
              type="file"
              // iOS convierte las fotos HEIC a JPEG al elegirlas con esta lista.
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => void pick(event)}
            />
            {notice && (
              <p role="status" className="text-muted-foreground text-sm">
                {notice}
              </p>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Cuenta" description="Vienen de tu cuenta de Google.">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Nombre</dt>
            <dd className="truncate font-medium">{user.displayName}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Email</dt>
            <dd className="truncate font-medium">{user.email}</dd>
          </div>
        </dl>
      </SettingsSection>

      {source !== null && (
        <Suspense fallback={null}>
          <ImageCropDialog
            key={source}
            source={source}
            shape="round"
            title="Encuadra tu foto"
            saving={upload.isPending}
            onCancel={() => setSource(null)}
            onSave={(image) => upload.mutate(image)}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Quitar foto"
        description="Volverás a la foto de tu cuenta de Google o a tus iniciales."
        confirmLabel="Quitar"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          setConfirmRemove(false);
          remove.mutate();
        }}
        onOpenChange={setConfirmRemove}
      />
    </SettingsPage>
  );
}
