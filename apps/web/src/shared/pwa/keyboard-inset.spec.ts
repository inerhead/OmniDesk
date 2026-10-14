import { describe, expect, it } from 'vitest';
import { keyboardLift } from './keyboard-inset';

describe('keyboardLift', () => {
  it('no sube nada con el teclado cerrado', () => {
    expect(keyboardLift(844, 844, 844, 0, true)).toEqual({ lift: 0, open: false });
  });

  it('no confunde el notch y el indicador de inicio de la PWA con el teclado', () => {
    expect(keyboardLift(844, 844, 752, 0, false)).toEqual({ lift: 0, open: false });
  });

  it('anula el hueco sin subir la caja si el layout ya se encogió', () => {
    expect(keyboardLift(844, 520, 520, 0, true)).toEqual({ lift: 0, open: true });
  });

  it('sube la caja cuando el layout sigue a pantalla completa', () => {
    expect(keyboardLift(844, 844, 520, 0, true)).toEqual({ lift: 324, open: true });
  });
});
