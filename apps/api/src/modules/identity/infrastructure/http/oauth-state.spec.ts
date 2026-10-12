import { describe, expect, it } from 'vitest';
import { OAUTH_STATE_TTL_MS, signOAuthState, verifyOAuthState } from './oauth-state';

const now = new Date('2026-10-12T10:00:00.000Z');
const state = { next: '/conversations', nonce: 'n1', exp: now.getTime() + OAUTH_STATE_TTL_MS };

describe('state de OAuth', () => {
  it('verifica un state firmado con el mismo secreto y nonce', () => {
    expect(verifyOAuthState(signOAuthState(state, 's3cret'), 's3cret', 'n1', now)).toEqual(state);
  });

  it('rechaza otro secreto, otro nonce o un state alterado', () => {
    const signed = signOAuthState(state, 's3cret');
    expect(verifyOAuthState(signed, 'otro', 'n1', now)).toBeNull();
    expect(verifyOAuthState(signed, 's3cret', 'n2', now)).toBeNull();
    expect(verifyOAuthState(signed, 's3cret', undefined, now)).toBeNull();
    const tampered = signOAuthState({ ...state, next: '/x' }, 's3cret').split('.')[0];
    expect(verifyOAuthState(`${tampered}.${signed.split('.')[1]}`, 's3cret', 'n1', now)).toBeNull();
  });

  it('rechaza un state vencido o mal formado', () => {
    const signed = signOAuthState(state, 's3cret');
    expect(verifyOAuthState(signed, 's3cret', 'n1', new Date(state.exp))).toBeNull();
    expect(verifyOAuthState('basura', 's3cret', 'n1', now)).toBeNull();
    expect(verifyOAuthState(undefined, 's3cret', 'n1', now)).toBeNull();
  });
});
