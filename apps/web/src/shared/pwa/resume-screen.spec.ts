import { describe, expect, it } from 'vitest';
import { resumeNeedsReload } from './resume-screen';

const fresh = {
  wasDiscarded: false,
  restoredFromCache: false,
  rootChildCount: 2,
  rootHeight: 800,
  now: 20_000,
  lastReloadAt: 0,
};

describe('resumeNeedsReload', () => {
  it('no recarga una pantalla que sigue pintada', () => {
    expect(resumeNeedsReload(fresh)).toBe(false);
  });

  it('recarga si iOS descartó la página o la restauró en blanco desde la caché', () => {
    expect(resumeNeedsReload({ ...fresh, wasDiscarded: true })).toBe(true);
    expect(resumeNeedsReload({ ...fresh, restoredFromCache: true })).toBe(true);
  });

  it('recarga si la raíz quedó vacía', () => {
    expect(resumeNeedsReload({ ...fresh, rootChildCount: 0, rootHeight: 0 })).toBe(true);
  });

  it('no entra en un bucle de recargas', () => {
    expect(resumeNeedsReload({ ...fresh, wasDiscarded: true, lastReloadAt: 10_000, now: 12_000 })).toBe(
      false,
    );
  });
});
