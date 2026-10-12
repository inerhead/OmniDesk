import { SESSION_COOKIE } from '@omnidesk/contracts';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../../../shared/config/env';
import { parseCookies } from '../../../../shared/infrastructure/http/cookies';
import { SESSION_TTL_MS } from '../../domain/session';

/** `HttpOnly` + `SameSite=Lax` siempre; `Secure` según `SESSION_COOKIE_SECURE` (obligatorio en producción). */
export function sessionCookieOptions(env: Env): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: env.SESSION_COOKIE_SECURE, path: '/' };
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  return parseCookies(cookieHeader)[SESSION_COOKIE] || undefined;
}

export function readRequestSessionToken(request: Request): string | undefined {
  return readSessionToken(request.header('cookie'));
}

export function setSessionCookie(response: Response, env: Env, token: string): void {
  response.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(env), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(response: Response, env: Env): void {
  response.clearCookie(SESSION_COOKIE, sessionCookieOptions(env));
}
