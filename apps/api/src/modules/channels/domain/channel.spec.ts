import { describe, expect, it } from 'vitest';
import { acceptedSigningSecrets, CREDENTIALS_GRACE_MS, isCredentialActive } from './channel';

const now = new Date('2026-10-14T10:00:00.000Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const current = new Uint8Array([1]);
const previous = new Uint8Array([2]);

describe('acceptedSigningSecrets', () => {
  it('sin secretos no exige nada', () => {
    expect(
      acceptedSigningSecrets({ current: null, previous: null, previousUntil: null }, now),
    ).toEqual([]);
  });

  it('acepta el anterior solo mientras está vigente', () => {
    const secrets = { current, previous, previousUntil: later(CREDENTIALS_GRACE_MS) };
    expect(acceptedSigningSecrets(secrets, now)).toEqual([current, previous]);
    expect(acceptedSigningSecrets(secrets, later(CREDENTIALS_GRACE_MS))).toEqual([current]);
  });
});

describe('isCredentialActive', () => {
  it('vale sin revocar y sin vencimiento, o con vencimiento futuro', () => {
    expect(isCredentialActive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(isCredentialActive({ revokedAt: null, expiresAt: later(1) }, now)).toBe(true);
  });

  it('no vale revocada o vencida', () => {
    expect(isCredentialActive({ revokedAt: now, expiresAt: null }, now)).toBe(false);
    expect(isCredentialActive({ revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
});
