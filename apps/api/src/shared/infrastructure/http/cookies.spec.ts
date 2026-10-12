import { describe, expect, it } from 'vitest';
import { parseCookies } from './cookies';

describe('parseCookies', () => {
  it('lee pares nombre=valor y decodifica', () => {
    expect(parseCookies('a=1; omnidesk_session=abc%2Fd; b=x=y')).toEqual({
      a: '1',
      omnidesk_session: 'abc/d',
      b: 'x=y',
    });
  });

  it('ignora vacíos y conserva el primer valor repetido', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('; sin-igual; a=1; a=2')).toEqual({ a: '1' });
  });
});
