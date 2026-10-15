import { useState } from 'react';

/** Estado de las acciones de un paso: ocupado y el aviso que se muestra dentro del paso. */
export function useStepAction(refresh: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');

  async function run(work: () => Promise<string | void>) {
    setPending(true);
    setNotice('');
    try {
      const message = await work();
      await refresh();
      if (message) setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo completar la acción');
    } finally {
      setPending(false);
    }
  }

  return { pending, notice, setNotice, run };
}
