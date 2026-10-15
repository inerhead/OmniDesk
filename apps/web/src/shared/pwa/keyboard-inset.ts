/** Por debajo de esto es el notch o el indicador de inicio, no el teclado. */
const KEYBOARD_MIN_PX = 120;

export type KeyboardFrame = {
  top: number;
  height: number | null;
  open: boolean;
  /** Sube solo el composer. La página no cambia de alto, así el foco no parece una recarga. */
  overlap: number;
};

const CLOSED: KeyboardFrame = { top: 0, height: null, open: false, overlap: 0 };

/**
 * El iPhone a veces encoge el layout, a veces solo lo desplaza y a veces no toca
 * ninguno de los dos. En el último caso el composer sube con `overlap` y el resto
 * de la pantalla se queda quieto.
 */
export function keyboardFrame(
  baseline: number,
  innerHeight: number,
  viewportHeight: number,
  viewportOffsetTop: number,
  textFocused: boolean,
): KeyboardFrame {
  if (!textFocused) return CLOSED;
  const covered = Math.max(0, Math.round(baseline - viewportHeight));
  if (covered <= KEYBOARD_MIN_PX) return CLOSED;

  const layoutShrunk = innerHeight < baseline - 80;
  // El navegador ya encogió la página: mover #root otra vez se ve como una recarga.
  if (layoutShrunk && viewportOffsetTop < 24) {
    return { top: 0, height: null, open: true, overlap: 0 };
  }

  // Desplazó el viewport y la cabecera se iría. Ahí sí hay que seguir el rectángulo visible.
  if (viewportOffsetTop >= 24) {
    return {
      top: Math.round(viewportOffsetTop),
      height: Math.round(viewportHeight),
      open: true,
      overlap: 0,
    };
  }

  return { top: 0, height: null, open: true, overlap: covered };
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

/** Mientras se escribe, sube solo el composer y anula el hueco del indicador de inicio. */
export function bindKeyboardInset(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const root = document.documentElement;
  let baseline = window.innerHeight;

  const sync = () => {
    const focused = editingText();
    if (!focused) baseline = Math.max(baseline, window.innerHeight, viewport.height);
    const { top, height, open, overlap } = keyboardFrame(
      baseline,
      window.innerHeight,
      viewport.height,
      viewport.offsetTop,
      focused,
    );
    root.style.setProperty('--vv-top', `${top}px`);
    root.style.setProperty('--vv-height', height === null ? '100%' : `${height}px`);
    root.style.setProperty('--keyboard-overlap', `${overlap}px`);
    root.toggleAttribute('data-keyboard', open);
    root.toggleAttribute('data-keyboard-frame', height !== null);
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
    root.style.removeProperty('--vv-top');
    root.style.removeProperty('--vv-height');
    root.style.removeProperty('--keyboard-overlap');
    root.removeAttribute('data-keyboard');
    root.removeAttribute('data-keyboard-frame');
  };
}
