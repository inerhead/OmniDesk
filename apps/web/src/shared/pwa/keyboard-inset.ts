/**
 * Con el teclado abierto el iPhone a veces encoge el layout y a veces solo desplaza
 * el viewport. La caja debe ocupar exactamente el rectángulo visible: así la cabecera
 * sigue arriba y el composer queda pegado al teclado.
 */
export function keyboardFrame(
  baseline: number,
  viewportHeight: number,
  viewportOffsetTop: number,
  textFocused: boolean,
): { top: number; height: number | null; open: boolean } {
  // En la PWA el viewport visible ya es más bajo (notch + indicador). Sin un campo
  // enfocado eso no es el teclado.
  if (!textFocused) return { top: 0, height: null, open: false };
  const keyboard = Math.max(0, Math.round(baseline - viewportHeight - viewportOffsetTop));
  if (keyboard <= 80) return { top: 0, height: null, open: false };
  return {
    top: Math.max(0, Math.round(viewportOffsetTop)),
    height: Math.round(viewportHeight),
    open: true,
  };
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

/** Pega `#root` al viewport visible mientras se escribe, y anula el hueco del indicador de inicio. */
export function bindKeyboardInset(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const root = document.documentElement;
  let baseline = window.innerHeight;

  const sync = () => {
    const focused = editingText();
    if (!focused) baseline = Math.max(baseline, window.innerHeight, viewport.height);
    const { top, height, open } = keyboardFrame(
      baseline,
      viewport.height,
      viewport.offsetTop,
      focused,
    );
    root.style.setProperty('--vv-top', `${top}px`);
    root.style.setProperty('--vv-height', height === null ? '100%' : `${height}px`);
    root.toggleAttribute('data-keyboard', open);
    // Safari desplaza la página para mostrar el campo y se lleva la cabecera.
    if (open && window.scrollY !== 0) window.scrollTo(0, 0);
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
    root.removeAttribute('data-keyboard');
  };
}
