import { describe, expect, it } from 'vitest';
import { detectIos, resolveInstallMode } from './install-mode';

describe('resolveInstallMode', () => {
  it('no muestra nada si la app ya corre instalada', () => {
    expect(resolveInstallMode({ isStandalone: true, isIos: true, hasDeferredPrompt: true })).toBe(
      'installed',
    );
  });

  it('muestra el botón cuando el navegador ofrece beforeinstallprompt', () => {
    expect(resolveInstallMode({ isStandalone: false, isIos: false, hasDeferredPrompt: true })).toBe(
      'prompt',
    );
  });

  it('muestra instrucciones en iOS', () => {
    expect(resolveInstallMode({ isStandalone: false, isIos: true, hasDeferredPrompt: false })).toBe(
      'ios-instructions',
    );
  });

  it('no muestra nada si no hay forma de instalar', () => {
    expect(
      resolveInstallMode({ isStandalone: false, isIos: false, hasDeferredPrompt: false }),
    ).toBe('unavailable');
  });
});

describe('detectIos', () => {
  it('detecta iPhone', () => {
    expect(
      detectIos({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('detecta iPadOS que se presenta como Mac', () => {
    expect(
      detectIos({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('no confunde un Mac de escritorio con iOS', () => {
    expect(
      detectIos({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
