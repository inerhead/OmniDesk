import { useCallback, useSyncExternalStore } from 'react';

/** `true` mientras la media query se cumple; se actualiza al cambiar el tamaño de la ventana. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Breakpoint `xl` de Tailwind: a partir de aquí el panel de contacto es una columna. */
export const XL_QUERY = '(min-width: 80rem)';
