import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret-box';

const key = randomBytes(32);

describe('encryptSecret / decryptSecret', () => {
  it('ida y vuelta, sin el secreto en claro en el blob', () => {
    const blob = encryptSecret('whsec_super_secreto', key);

    expect(blob.includes(Buffer.from('whsec_super_secreto'))).toBe(false);
    expect(blob.length).toBe(12 + 'whsec_super_secreto'.length + 16);
    expect(decryptSecret(blob, key)).toBe('whsec_super_secreto');
  });

  it('usa un iv aleatorio: dos cifrados del mismo valor difieren', () => {
    expect(encryptSecret('x', key).equals(encryptSecret('x', key))).toBe(false);
  });

  it('un blob alterado falla', () => {
    const blob = encryptSecret('whsec_super_secreto', key);
    blob[14] = blob[14]! ^ 0xff;
    expect(() => decryptSecret(blob, key)).toThrow();
  });

  it('otra clave falla', () => {
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(32))).toThrow();
  });

  it('un blob demasiado corto falla', () => {
    expect(() => decryptSecret(Buffer.alloc(10), key)).toThrow(/inválido/);
  });
});
