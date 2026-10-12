import { describe, expect, it } from 'vitest';
import { parseSignatureHeader, signPayload, verifySignature } from './hmac-signature';

const secret = 'whsec_test';
const body = '{"a":1}';
const t = 1_760_000_000;
// Calculado de forma independiente (Python hmac + hashlib).
const KNOWN_V1 = 'f495e119a46eb6023c06ab057f70eee20b42a99ccba7a692b6af681055bfadd9';

describe('signPayload', () => {
  it('produce el vector conocido', () => {
    expect(signPayload(secret, body, t)).toBe(`t=${t},v1=${KNOWN_V1}`);
  });

  it('trunca el timestamp a segundos', () => {
    expect(signPayload(secret, body, t + 0.9)).toBe(`t=${t},v1=${KNOWN_V1}`);
  });
});

describe('verifySignature', () => {
  const header = signPayload(secret, body, t);

  it('acepta la firma correcta', () => {
    expect(verifySignature(header, body, [secret], t)).toBe('ok');
  });

  it('acepta hasta ±300 s y rechaza por fuera como expired', () => {
    expect(verifySignature(header, body, [secret], t + 300)).toBe('ok');
    expect(verifySignature(header, body, [secret], t - 300)).toBe('ok');
    expect(verifySignature(header, body, [secret], t + 301)).toBe('expired');
    expect(verifySignature(header, body, [secret], t - 301)).toBe('expired');
  });

  it('acepta el secreto anterior durante una rotación', () => {
    const old = signPayload('whsec_old', body, t);
    expect(verifySignature(old, body, ['whsec_new', 'whsec_old'], t)).toBe('ok');
    expect(verifySignature(old, body, ['whsec_new'], t)).toBe('mismatch');
  });

  it('un byte alterado del cuerpo no coincide', () => {
    expect(verifySignature(header, '{"a":2}', [secret], t)).toBe('mismatch');
  });

  it('el mismo JSON con otros espacios u orden de claves no coincide (se firman los bytes)', () => {
    const signed = '{"a":1,"b":2}';
    const h = signPayload(secret, signed, t);
    expect(verifySignature(h, '{ "a": 1, "b": 2 }', [secret], t)).toBe('mismatch');
    expect(verifySignature(h, '{"b":2,"a":1}', [secret], t)).toBe('mismatch');
  });

  it('distingue cabecera ausente y mal formada', () => {
    expect(verifySignature(undefined, body, [secret], t)).toBe('missing');
    expect(verifySignature('', body, [secret], t)).toBe('missing');
    expect(verifySignature('v1=abc', body, [secret], t)).toBe('malformed');
    expect(verifySignature(`t=${t},v1=zz`, body, [secret], t)).toBe('malformed');
    expect(verifySignature('basura', body, [secret], t)).toBe('malformed');
  });

  it('sin secretos no hay coincidencia', () => {
    expect(verifySignature(header, body, [], t)).toBe('mismatch');
  });
});

describe('parseSignatureHeader', () => {
  it('admite espacios y v1 en mayúsculas', () => {
    expect(parseSignatureHeader(`t=${t}, v1=${KNOWN_V1.toUpperCase()}`)).toEqual({
      t,
      v1: KNOWN_V1,
    });
  });
});
