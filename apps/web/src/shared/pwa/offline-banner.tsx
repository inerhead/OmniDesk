import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from './use-online-status';

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="alert"
      className="bg-warning text-warning-foreground flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
    >
      <WifiOff className="size-4" aria-hidden />
      Sin conexión
    </div>
  );
}
