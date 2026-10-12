import type { INestApplication } from '@nestjs/common';
import { SESSION_COOKIE } from '@omnidesk/contracts';
import request from 'supertest';
import { CreateSessionUseCase } from '../../src/modules/identity/application/create-session.use-case';

/** Origen de la web: los métodos que modifican datos lo exigen (`OriginGuard`). */
export const WEB_ORIGIN = 'http://localhost:8080';

/** `omnidesk_session=<token>` de la respuesta, listo para la cabecera `Cookie`. */
export function sessionCookieFrom(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies
    .map((value) => value.split(';')[0]!)
    .find(
      (value) => value.startsWith(`${SESSION_COOKIE}=`) && value.length > SESSION_COOKIE.length + 1,
    );
  if (!cookie) throw new Error('La respuesta no trae la cookie de sesión');
  return cookie;
}

/** Login de desarrollo de un miembro demo; devuelve su cookie de sesión. */
export async function devLogin(app: INestApplication, memberId: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/dev-login')
    .set('Origin', WEB_ORIGIN)
    .send({ memberId })
    .expect(200);
  return sessionCookieFrom(res.headers['set-cookie']);
}

/** Sesión directa para cualquier usuario (los que no son del tenant demo no tienen dev-login). */
export async function sessionFor(
  app: INestApplication,
  userId: string,
  activeTenantId?: string,
): Promise<string> {
  const { token } = await app
    .get(CreateSessionUseCase)
    .execute({ userId, ...(activeTenantId && { activeTenantId }) });
  return `${SESSION_COOKIE}=${token}`;
}
