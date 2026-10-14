import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { activeMembership, isManagerRole, useMe } from '@/features/auth/api/use-me';
import { ApiHttpError } from '@/shared/api/http-client';
import { detectIos, detectStandalone } from '@/shared/pwa/install-mode';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  currentPushSubscription,
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  fetchNotificationPreferences,
  fetchPushConfig,
  patchNotificationPreferences,
  postTestPush,
} from './push-api';

const PREFERENCES_KEY = ['notification-preferences'] as const;

type DeviceState = 'checking' | 'unavailable' | 'ios-install' | 'blocked' | 'off' | 'on';

function deviceState(configAvailable: boolean, subscribed: boolean): DeviceState {
  if (!configAvailable) return 'unavailable';
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unavailable';
  if (detectIos(navigator) && !detectStandalone()) return 'ios-install';
  if (Notification.permission === 'denied') return 'blocked';
  return subscribed ? 'on' : 'off';
}

export function NotificationsPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const config = useQuery({ queryKey: ['push-config'], queryFn: fetchPushConfig });
  const preferences = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: fetchNotificationPreferences,
  });
  useQuery({
    queryKey: ['push-subscription'],
    queryFn: async () => {
      const current = await currentPushSubscription();
      setSubscribed(current !== null);
      return current?.endpoint ?? null;
    },
  });

  const membership = me ? activeMembership(me) : null;
  const manager = membership ? isManagerRole(membership.role) : false;
  const state =
    config.isLoading || subscribed === null
      ? 'checking'
      : deviceState(config.isSuccess && config.data !== null, subscribed);

  const toggle = useMutation({
    mutationFn: async () => {
      if (state === 'on') {
        await disablePushOnThisDevice();
        return false;
      }
      if (!config.data) throw new Error('unavailable');
      await enablePushOnThisDevice(config.data.vapidPublicKey);
      return true;
    },
    onSuccess: (enabled) => {
      setSubscribed(enabled);
      setNotice(enabled ? 'Notificaciones activadas en este dispositivo.' : 'Desactivadas.');
    },
    onError: () => {
      setNotice(
        Notification.permission === 'denied'
          ? 'Bloqueadas: actívalas en los ajustes del navegador.'
          : 'No se pudo activar. Recarga la página e inténtalo de nuevo.',
      );
    },
  });

  const save = useMutation({
    mutationFn: patchNotificationPreferences,
    onSuccess: (next) => {
      queryClient.setQueryData(PREFERENCES_KEY, next);
      setNotice('Preferencias guardadas.');
    },
    onError: () => setNotice('No se pudieron guardar.'),
  });

  const test = useMutation({
    mutationFn: postTestPush,
    onSuccess: () => setNotice('Enviada. Si no aparece, revisa que este dispositivo esté activado.'),
    onError: (error) => {
      setNotice(
        error instanceof ApiHttpError && error.status === 503
          ? 'Este usuario no tiene dispositivos suscritos.'
          : 'No se pudo enviar la prueba.',
      );
    },
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Notificaciones</CardTitle>
          <CardDescription>
            Avisos de asignaciones, mensajes y envíos fallidos en este dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state === 'checking' && <p className="text-muted-foreground text-sm">Comprobando…</p>}
          {state === 'unavailable' && (
            <p className="text-sm">Notificaciones no disponibles en este entorno.</p>
          )}
          {state === 'ios-install' && (
            <p className="text-sm">
              Instala la app (Compartir → Añadir a pantalla de inicio) para recibir notificaciones.
            </p>
          )}
          {state === 'blocked' && (
            <p className="text-sm">Bloqueadas: actívalas en los ajustes del navegador.</p>
          )}
          {state === 'on' && <p className="text-sm">Activadas en este dispositivo.</p>}
          {(state === 'off' || state === 'on') && (
            <Button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
              {state === 'on' ? 'Desactivar en este dispositivo' : 'Activar notificaciones en este dispositivo'}
            </Button>
          )}
          {state === 'on' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              Enviar notificación de prueba
            </Button>
          )}
          {notice && (
            <p role="status" className="text-muted-foreground text-sm">
              {notice}
            </p>
          )}
        </CardContent>
      </Card>

      {preferences.data && (
        <Card>
          <CardHeader>
            <CardTitle>Qué avisarte</CardTitle>
            <CardDescription>Estas preferencias son de esta empresa.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Preference
              label="Me asignan una conversación"
              checked={preferences.data.assigned}
              onChange={(assigned) => save.mutate({ ...preferences.data!, assigned })}
            />
            <Preference
              label="El cliente escribe en una conversación mía"
              checked={preferences.data.customerMessage}
              onChange={(customerMessage) => save.mutate({ ...preferences.data!, customerMessage })}
            />
            <Preference
              label="Falla un mensaje que envié"
              checked={preferences.data.sendFailed}
              onChange={(sendFailed) => save.mutate({ ...preferences.data!, sendFailed })}
            />
            {manager && (
              <Preference
                label="La IA abre una conversación nueva"
                checked={preferences.data.newAiConversation}
                onChange={(newAiConversation) =>
                  save.mutate({ ...preferences.data!, newAiConversation })
                }
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Preference({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4"
      />
    </label>
  );
}
