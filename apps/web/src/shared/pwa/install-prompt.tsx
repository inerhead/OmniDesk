import { Download, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { detectIos, detectStandalone, resolveInstallMode } from './install-mode';

/** Evento no estándar de Chromium; no está en lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(detectStandalone);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const mode = resolveInstallMode({
    isStandalone,
    isIos: detectIos(navigator),
    hasDeferredPrompt: deferredPrompt !== null,
  });

  if (mode === 'prompt') {
    const install = async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    };
    return (
      <Button size="sm" onClick={install}>
        <Download aria-hidden />
        Instalar app
      </Button>
    );
  }

  if (mode === 'ios-instructions') {
    return (
      <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm">
        Para instalar: toca <Share className="size-4" aria-label="Compartir" /> Compartir y luego
        <strong className="text-foreground">“Añadir a pantalla de inicio”</strong>.
      </p>
    );
  }

  return null;
}
