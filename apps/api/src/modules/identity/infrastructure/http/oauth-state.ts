import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Vida del `state` de OAuth: lo que tarda el usuario en elegir su cuenta de Google. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthState {
  /** Ruta interna a la que volver (ya validada con `safeNextPath`). */
  next: string | null;
  /** Igual al de la cookie `omnidesk_oauth`: ata el callback al navegador que empezó el login. */
  nonce: string;
  /** Epoch ms de vencimiento. */
  exp: number;
}

export function newOAuthNonce(): string {
  return randomBytes(16).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** `<payload base64url>.<firma HMAC-SHA256>`. */
export function signOAuthState(state: OAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** El `state` si la firma es válida, no venció y su nonce coincide con el de la cookie; si no, `null`. */
export function verifyOAuthState(
  value: unknown,
  secret: string,
  nonce: string | undefined,
  now: Date,
): OAuthState | null {
  if (typeof value !== 'string' || !nonce) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthState;
    if (state.nonce !== nonce || typeof state.exp !== 'number' || state.exp <= now.getTime()) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}
