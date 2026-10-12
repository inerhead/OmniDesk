import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { Authenticator } from 'passport';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import { CLOCK, type Clock } from '../../../../shared/application/clock.port';
import { ENV, type Env } from '../../../../shared/config/env';
import { parseCookies } from '../../../../shared/infrastructure/http/cookies';
import { GoogleLoginUseCase } from '../../application/google-login.use-case';
import { mapGoogleProfile } from '../../domain/google-profile';
import { postLoginPath, safeNextPath } from '../../domain/next-path';
import { newOAuthNonce, OAUTH_STATE_TTL_MS, signOAuthState, verifyOAuthState } from './oauth-state';
import { setSessionCookie } from './session-cookie';

/** Passport aislado (sin el singleton global) con solo la estrategia de Google. */
function createGoogleAuthenticator(clientID: string, clientSecret: string, callbackURL: string) {
  const authenticator = new Authenticator();
  authenticator.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      (_accessToken: string, _refreshToken: string, profile: Profile, done) => done(null, profile),
    ),
  );
  return authenticator;
}

type GoogleAuthenticator = ReturnType<typeof createGoogleAuthenticator>;

const OAUTH_COOKIE = 'omnidesk_oauth';
const OAUTH_COOKIE_PATH = '/api/v1/auth/google';

/**
 * Login con Google (Passport, flujo de página completa: sin popups, también en la PWA de iOS).
 * `next` viaja en un `state` firmado y atado al navegador con la cookie `omnidesk_oauth`.
 * Sin `GOOGLE_CLIENT_ID` responde 404.
 */
@ApiExcludeController()
@Controller({ path: 'auth/google', version: '1' })
export class GoogleAuthController {
  private readonly logger = new Logger(GoogleAuthController.name);
  private readonly passport?: GoogleAuthenticator;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly googleLogin: GoogleLoginUseCase,
  ) {
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      this.passport = createGoogleAuthenticator(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        env.GOOGLE_CALLBACK_URL,
      );
    }
  }

  @Get()
  start(@Query('next') next: unknown, @Req() request: Request, @Res() response: Response): void {
    const passport = this.enabled();
    const nonce = newOAuthNonce();
    const state = signOAuthState(
      {
        next: safeNextPath(next),
        nonce,
        exp: this.clock.now().getTime() + OAUTH_STATE_TTL_MS,
      },
      this.env.GOOGLE_CLIENT_SECRET!,
    );
    response.cookie(OAUTH_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.SESSION_COOKIE_SECURE,
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_STATE_TTL_MS,
    });
    passport.authenticate('google', {
      session: false,
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    })(request, response);
  }

  @Get('callback')
  async callback(
    @Query('state') rawState: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const passport = this.enabled();
    const nonce = parseCookies(request.header('cookie'))[OAUTH_COOKIE];
    response.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
    const state = verifyOAuthState(
      rawState,
      this.env.GOOGLE_CLIENT_SECRET!,
      nonce,
      this.clock.now(),
    );
    if (!state) return this.redirect(response, '/login?error=oauth');

    let profile: Profile | null;
    try {
      profile = await new Promise<Profile | null>((resolve, reject) => {
        const next: NextFunction = (error?: unknown) => (error ? reject(error) : resolve(null));
        passport.authenticate('google', { session: false }, (error: unknown, user: unknown) =>
          error ? reject(error) : resolve((user as Profile) || null),
        )(request, response, next);
      });
    } catch (error) {
      this.logger.warn(`Callback de Google fallido: ${String(error)}`);
      return this.redirect(response, '/login?error=oauth');
    }

    const identity = profile ? mapGoogleProfile(profile) : null;
    if (!identity) return this.redirect(response, '/login?error=email');

    const login = await this.googleLogin.execute(identity, request.header('user-agent') ?? null);
    setSessionCookie(response, this.env, login.token);
    this.redirect(response, postLoginPath(state.next, login.hasMemberships));
  }

  private enabled(): GoogleAuthenticator {
    if (!this.passport) throw new NotFoundException('Login con Google no configurado');
    return this.passport;
  }

  private redirect(response: Response, path: string): void {
    response.redirect(302, new URL(path, this.env.APP_URL).toString());
  }
}
