export type InstallMode = 'installed' | 'prompt' | 'ios-instructions' | 'unavailable';

export interface InstallContext {
  isStandalone: boolean;
  isIos: boolean;
  hasDeferredPrompt: boolean;
}

/**
 * - Ya instalada (standalone): no se muestra nada.
 * - Android/escritorio con `beforeinstallprompt`: botón "Instalar app".
 * - iOS (no existe `beforeinstallprompt`): instrucciones de "Añadir a pantalla de inicio".
 */
export function resolveInstallMode({
  isStandalone,
  isIos,
  hasDeferredPrompt,
}: InstallContext): InstallMode {
  if (isStandalone) return 'installed';
  if (hasDeferredPrompt) return 'prompt';
  if (isIos) return 'ios-instructions';
  return 'unavailable';
}

export function detectIos(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
): boolean {
  // iPadOS se presenta como "MacIntel" con pantalla táctil.
  return (
    /iphone|ipad|ipod/i.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  );
}

export function detectStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
}
