import { describe, expect, it } from 'vitest';
import { keyboardFrame } from './keyboard-inset';

describe('keyboardFrame', () => {
  it('no recorta con el teclado cerrado', () => {
    expect(keyboardFrame(844, 844, 0, true)).toEqual({ top: 0, height: null, open: false });
  });

  it('no confunde el notch y el indicador de inicio de la PWA con el teclado', () => {
    expect(keyboardFrame(844, 752, 0, false)).toEqual({ top: 0, height: null, open: false });
  });

  it('ocupa el alto visible si el layout ya se encogió', () => {
    expect(keyboardFrame(844, 520, 0, true)).toEqual({ top: 0, height: 520, open: true });
  });

  it('sigue el viewport si el teclado desplaza la página y esconde la cabecera', () => {
    expect(keyboardFrame(844, 390, 180, true)).toEqual({ top: 180, height: 390, open: true });
  });
});
