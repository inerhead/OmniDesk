const RELOAD_GAP_MS = 15_000;
const reloadKey = 'omnidesk-resume-reload';

/** La página que iOS restaura al volver a veces no tiene contenido, o la capa fija se perdió. */
export function resumeNeedsReload(input: {
  wasDiscarded: boolean;
  restoredFromCache: boolean;
  rootChildCount: number;
  rootHeight: number;
  now: number;
  lastReloadAt: number;
}): boolean {
  if (input.now - input.lastReloadAt < RELOAD_GAP_MS) return false;
  if (input.wasDiscarded || input.restoredFromCache) return true;
  return input.rootChildCount === 0 || input.rootHeight < 2;
}

function lastReloadAt(): number {
  const raw = sessionStorage.getItem(reloadKey);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function reloadOnce(now: number): void {
  sessionStorage.setItem(reloadKey, String(now));
  window.location.reload();
}

/** iOS tira la capa de `#root` (position: fixed) al suspender la app. Esto la vuelve a pintar. */
function replayRootLayer(): void {
  const root = document.getElementById('root');
  if (!root) return;
  const previous = root.style.transform;
  root.style.transform = 'translateZ(0)';
  void root.offsetHeight;
  root.style.transform = previous;
}

function recover(restoredFromCache: boolean): void {
  replayRootLayer();
  const root = document.getElementById('root');
  const discarded =
    'wasDiscarded' in document &&
    (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
  if (
    !resumeNeedsReload({
      wasDiscarded: discarded,
      restoredFromCache,
      rootChildCount: root?.childElementCount ?? 0,
      rootHeight: root?.getBoundingClientRect().height ?? 0,
      now: Date.now(),
      lastReloadAt: lastReloadAt(),
    })
  ) {
    return;
  }
  reloadOnce(Date.now());
}

/** Si al volver del segundo plano la app quedó en blanco, la repinta o la recarga una vez. */
export function bindResumeScreen(): () => void {
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    recover(false);
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    recover(true);
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onPageShow);
  };
}
