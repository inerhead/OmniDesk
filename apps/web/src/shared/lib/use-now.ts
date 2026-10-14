import { useEffect, useState } from 'react';

/** Reloj de pantalla: re-renderiza cada `intervalMs` para textos que dependen de la hora. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
