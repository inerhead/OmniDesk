const RELOAD_FALLBACK_MS = 1_000;

interface WaitingWorker {
  postMessage(message: unknown): void;
}

interface UpdateRegistration {
  waiting: WaitingWorker | null;
}

interface ServiceWorkerContainerLike {
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

// `updateServiceWorker(true)` de vite-plugin-pwa solo manda SKIP_WAITING.
// La recarga depende de `controlling.isUpdate`, y ese flag queda en false si
// la ventana se registró antes de tener un controlador. El clic no recargaba.
export function applyAppUpdate(
  registration: UpdateRegistration | undefined,
  serviceWorker: ServiceWorkerContainerLike | undefined,
  reload: () => void,
  schedule: (callback: () => void, delayMs: number) => void,
): void {
  let done = false;
  const reloadOnce = () => {
    if (done) return;
    done = true;
    reload();
  };

  const waiting = registration?.waiting;
  if (!waiting || !serviceWorker) {
    reloadOnce();
    return;
  }

  serviceWorker.addEventListener('controllerchange', reloadOnce);
  waiting.postMessage({ type: 'SKIP_WAITING' });
  schedule(reloadOnce, RELOAD_FALLBACK_MS);
}
