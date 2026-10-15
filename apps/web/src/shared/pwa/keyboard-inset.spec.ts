import { describe, expect, it } from 'vitest';
import { keyboardFrame } from './keyboard-inset';

const closed = { top: 0, height: null, open: false, overlap: 0 };

describe('keyboardFrame', () => {
  it('no recorta con el teclado cerrado', () => {
    expect(keyboardFrame(844, 844, 844, 0, true)).toEqual(closed);
  });

  it('no confunde el notch y el indicador de inicio de la PWA con el teclado', () => {
    expect(keyboardFrame(844, 844, 752, 0, false)).toEqual(closed);
    expect(keyboardFrame(844, 844, 752, 0, true)).toEqual(closed);
  });

  it('no vuelve a recortar la página si el layout ya se encogió', () => {
    expect(keyboardFrame(844, 520, 520, 0, true)).toEqual({
      top: 0,
      height: null,
      open: true,
      overlap: 0,
    });
  });

  it('solo sube el composer si la página no se movió', () => {
    expect(keyboardFrame(844, 844, 520, 0, true)).toEqual({
      top: 0,
      height: null,
      open: true,
      overlap: 324,
    });
  });

  it('sigue el viewport si el teclado desplaza la página y esconde la cabecera', () => {
    expect(keyboardFrame(844, 844, 390, 180, true)).toEqual({
      top: 180,
      height: 390,
      open: true,
      overlap: 0,
    });
  });

  it('sigue abierto aunque el desplazamiento se coma el alto del teclado', () => {
    expect(keyboardFrame(844, 844, 400, 400, true)).toEqual({
      top: 400,
      height: 400,
      open: true,
      overlap: 0,
    });
  });
});
