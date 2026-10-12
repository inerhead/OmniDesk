import { describe, expect, it } from 'vitest';
import { mapGoogleProfile } from './google-profile';
import { postLoginPath, safeNextPath } from './next-path';
import {
  isSessionActive,
  LAST_SEEN_THROTTLE_MS,
  newSessionWindow,
  SESSION_TTL_MS,
  slideSession,
  type Session,
} from './session';

const t0 = new Date('2026-10-12T10:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  userId: 'u1',
  activeTenantId: 't1',
  ...newSessionWindow(t0),
  revokedAt: null,
  ...overrides,
});

describe('sesión', () => {
  it('dura 30 días desde el último uso', () => {
    expect(newSessionWindow(t0).expiresAt).toEqual(at(SESSION_TTL_MS));
    expect(isSessionActive(session(), at(SESSION_TTL_MS - 1))).toBe(true);
    expect(isSessionActive(session(), at(SESSION_TTL_MS))).toBe(false);
  });

  it('una sesión revocada no vale', () => {
    expect(isSessionActive(session({ revokedAt: t0 }), t0)).toBe(false);
  });

  it('se desliza como máximo cada 5 min', () => {
    expect(slideSession(session(), at(LAST_SEEN_THROTTLE_MS - 1))).toBeNull();
    expect(slideSession(session(), at(LAST_SEEN_THROTTLE_MS))).toEqual({
      lastSeenAt: at(LAST_SEEN_THROTTLE_MS),
      expiresAt: at(LAST_SEEN_THROTTLE_MS + SESSION_TTL_MS),
    });
  });
});

describe('mapGoogleProfile', () => {
  const profile = {
    id: '1234567890',
    displayName: ' Laura Gómez ',
    emails: [{ value: 'Laura@Example.COM', verified: true }],
    photos: [{ value: 'https://lh3.googleusercontent.com/a/x' }],
  };

  it('toma el sub, el email verificado en minúsculas, el nombre y la foto', () => {
    expect(mapGoogleProfile(profile)).toEqual({
      googleSub: '1234567890',
      email: 'laura@example.com',
      displayName: 'Laura Gómez',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
    });
  });

  it('sin nombre usa la parte local del email y sin foto deja null', () => {
    expect(mapGoogleProfile({ ...profile, displayName: '', photos: [] })).toMatchObject({
      displayName: 'laura',
      avatarUrl: null,
    });
  });

  it('acepta verified como texto', () => {
    expect(
      mapGoogleProfile({ ...profile, emails: [{ value: 'a@b.co', verified: 'true' }] })?.email,
    ).toBe('a@b.co');
  });

  it('sin email verificado no hay identidad', () => {
    expect(mapGoogleProfile({ ...profile, emails: [{ value: 'a@b.co', verified: false }] })).toBe(
      null,
    );
    expect(mapGoogleProfile({ ...profile, emails: undefined })).toBeNull();
  });
});

describe('safeNextPath', () => {
  it.each(['/conversations', '/conversations?inbox=mine&q=juan', '/invite/abc'])(
    'acepta la ruta interna %s',
    (next) => {
      expect(safeNextPath(next)).toBe(next);
    },
  );

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'conversations',
    'javascript:alert(1)',
    '/a\\b',
    '/a\nb',
    '',
    undefined,
    42,
  ])('descarta %s', (next) => {
    expect(safeNextPath(next)).toBeNull();
  });
});

describe('postLoginPath', () => {
  it('sin membresías lleva a /onboarding, salvo una invitación', () => {
    expect(postLoginPath(null, false)).toBe('/onboarding');
    expect(postLoginPath('/conversations', false)).toBe('/onboarding');
    expect(postLoginPath('/invite/abc', false)).toBe('/invite/abc');
  });

  it('con membresías respeta next o va a /conversations', () => {
    expect(postLoginPath('/status', true)).toBe('/status');
    expect(postLoginPath(null, true)).toBe('/conversations');
  });
});
