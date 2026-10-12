import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/shared/ui/button';

// Los agentes dejan la app abierta todo el día: se busca una versión nueva cada hora.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
  });

  if (!needRefresh) return null;

  // No se recarga sola: el agente decide cuándo, para no perder lo que está escribiendo.
  return (
    <div
      role="status"
      className="bg-card text-card-foreground fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border p-3 shadow-lg"
    >
      <span className="text-sm font-medium">Nueva versión disponible</span>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          <RefreshCw aria-hidden />
          Actualizar
        </Button>
        <Button size="sm" variant="ghost" aria-label="Cerrar" onClick={() => setNeedRefresh(false)}>
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}
