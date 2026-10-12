import { normalizeEmail, type GoogleIdentity } from './user';

/** Lo que usamos del perfil que entrega `passport-google-oauth20`. */
export interface GoogleProfileLike {
  id: string;
  displayName?: string;
  emails?: Array<{ value: string; verified?: boolean | string }>;
  photos?: Array<{ value: string }>;
}

/** Identidad a partir del perfil de Google; `null` si no trae un email verificado. */
export function mapGoogleProfile(profile: GoogleProfileLike): GoogleIdentity | null {
  const email = profile.emails?.find(
    (candidate) => candidate.verified === true || candidate.verified === 'true',
  )?.value;
  if (!profile.id || !email) return null;
  const normalized = normalizeEmail(email);
  return {
    googleSub: profile.id,
    email: normalized,
    displayName: profile.displayName?.trim() || normalized.split('@')[0]!,
    avatarUrl: profile.photos?.[0]?.value ?? null,
  };
}
