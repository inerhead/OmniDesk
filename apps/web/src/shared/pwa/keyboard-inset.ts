/**
 * El iPhone no siempre encoge el layout al abrir el teclado. Si ya lo encogió,
 * subir la caja otra vez dejaría un hueco; si no, la caja sigue a pantalla completa
 * y el campo queda tapado o con una franja.
 */
export function keyboardLift(
  baseline: number,
  innerHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
  textFocused: boolean,
): { lift: number; open: boolean } {
  // En la PWA del iPhone el viewport visible ya es más bajo que innerHeight
  // (notch + indicador de inicio). Sin un campo enfocado eso no es el teclado.
  if (!textFocused) return { lift: 0, open: false };
  const keyboard = Math.max(0, Math.round(baseline - viewportHeight - viewportOffsetTop));
  const open = keyboard > 80;
  const layoutShrunk = innerHeight < baseline - 40;
  return { lift: open && !layoutShrunk ? keyboard : 0, open };
}

function editingText(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(el.type);
}

/** Sigue al teclado: sube `#root` solo si el viewport de layout no se encogió, y anula el hueco del home indicator. */
export function bindKeyboardInset(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const root = document.documentElement;
  let baseline = window.innerHeight;

  const sync = () => {
    const focused = editingText();
    if (!focused) baseline = Math.max(baseline, window.innerHeight, viewport.height);
    const { lift, open } = keyboardLift(
      baseline,
      window.innerHeight,
      viewport.height,
      viewport.offsetTop,
      focused,
    );
    root.style.setProperty('--keyboard-lift', `${lift}px`);
    root.toggleAttribute('data-keyboard', open);
  };

  const onOrientation = () => {
    window.setTimeout(() => {
      baseline = window.innerHeight;
      sync();
    }, 250);
  };

  sync();
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', sync);
  window.addEventListener('orientationchange', onOrientation);
  return () => {
    viewport.removeEventListener('resize', sync);
    viewport.removeEventListener('scroll', sync);
    document.removeEventListener('focusin', sync);
    document.removeEventListener('focusout', sync);
    window.removeEventListener('orientationchange', onOrientation);
    root.style.removeProperty('--keyboard-lift');
    root.removeAttribute('data-keyboard');
  };
}
