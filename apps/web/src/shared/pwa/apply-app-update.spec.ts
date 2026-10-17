import { describe, expect, it } from 'vitest';
import { applyAppUpdate } from './apply-app-update';

describe('applyAppUpdate', () => {
  it('recarga al instante si no hay un worker en espera', () => {
    const reloads: number[] = [];
    applyAppUpdate(undefined, undefined, () => reloads.push(1), () => {
      throw new Error('no debía programar un reintento');
    });
    expect(reloads).toEqual([1]);
  });

  it('pide SKIP_WAITING y recarga cuando el worker nuevo toma el control', () => {
    const messages: unknown[] = [];
    let onControllerChange: (() => void) | undefined;
    const scheduled: Array<() => void> = [];
    const reloads: number[] = [];

    applyAppUpdate(
      { waiting: { postMessage: (message) => messages.push(message) } },
      { addEventListener: (_type, listener) => (onControllerChange = listener) },
      () => reloads.push(1),
      (callback) => scheduled.push(callback),
    );

    expect(messages).toEqual([{ type: 'SKIP_WAITING' }]);
    onControllerChange?.();
    scheduled[0]?.();
    expect(reloads).toEqual([1]);
  });

  it('recarga igual si el worker nuevo no avisa que tomó el control', () => {
    const reloads: number[] = [];
    let fallback: (() => void) | undefined;

    applyAppUpdate(
      { waiting: { postMessage: () => undefined } },
      { addEventListener: () => undefined },
      () => reloads.push(1),
      (callback) => (fallback = callback),
    );

    fallback?.();
    expect(reloads).toEqual([1]);
  });
});
