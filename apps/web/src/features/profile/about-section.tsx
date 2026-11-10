import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { fetchHealth } from '@/features/health/api/fetch-health';
import { formatVersion } from '@/features/health/model/system-status';
import { appVersion } from '@/shared/config/app-version';
import { applyAppUpdate } from '@/shared/pwa/apply-app-update';
import { Button } from '@/shared/ui/button';
import { SettingsSection } from '@/shared/ui/settings-section';
import { Skeleton } from '@/shared/ui/skeleton';
import { versionStatus } from './version-status';

const INSTALL_TIMEOUT_MS = 10_000;

/** Espera a que termine de instalarse el service worker que encontró `update()`, si hay uno. */
function waitForInstall(registration: ServiceWorkerRegistration): Promise<void> {
  const installing = registration.installing;
  if (!installing) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      installing.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (installing.state !== 'installing') done();
    };
    installing.addEventListener('statechange', onChange);
    window.setTimeout(done, INSTALL_TIMEOUT_MS);
  });
}

/** Busca la versión nueva de la app, activa su service worker y recarga. Sin service worker, recarga. */
async function updateApp() {
  const reload = () => window.location.reload();
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) {
    reload();
    return;
  }
  try {
    await registration.update();
    await waitForInstall(registration);
  } catch {
    // Sin red o sin el sw.ts nuevo: applyAppUpdate recarga igual.
  }
  applyAppUpdate(registration, navigator.serviceWorker, reload, (callback, delayMs) => {
    window.setTimeout(callback, delayMs);
  });
}

/**
 * «Acerca de» en `/settings/profile` (SPEC 29): la versión desplegada en el servidor (`/health`) y la
 * de la app de este dispositivo. Si no coinciden, ofrece actualizar; nunca recarga sola.
 */
export function AboutSection() {
  const [updating, setUpdating] = useState(false);
  // Sin polling: basta con la versión al abrir la página (`/status` ya vigila el API).
  const health = useQuery({
    queryKey: ['health', 'about'],
    queryFn: fetchHealth,
    retry: false,
  });
  const serverVersion = health.data?.health.version ?? null;
  const status = versionStatus(appVersion, serverVersion);

  return (
    <SettingsSection title="Acerca de" description="La versión de OmniDesk.">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">Versión del servidor</dt>
          <dd className="truncate font-medium">
            {health.isPending ? (
              <Skeleton className="h-5 w-16" aria-label="Cargando…" />
            ) : serverVersion !== null ? (
              formatVersion(serverVersion)
            ) : (
              'No disponible'
            )}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">Versión de la app</dt>
          <dd className="truncate font-medium">{formatVersion(appVersion)}</dd>
        </div>
      </dl>
      {status === 'different' && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" className="text-muted-foreground text-sm">
            Este dispositivo usa una versión distinta de la desplegada.
          </p>
          <Button
            type="button"
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              void updateApp();
            }}
          >
            <RefreshCw aria-hidden />
            Actualizar
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
