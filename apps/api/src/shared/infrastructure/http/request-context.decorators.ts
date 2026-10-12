import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type {
  ActorContext,
  IntegrationContext,
  SessionContext,
  TenantContext,
} from '../../application/request-context';

/** Los guards guardan aquí el contexto resuelto; los controladores lo leen con los decoradores. */
export interface ContextualRequest extends Request {
  integration?: IntegrationContext;
  session?: SessionContext;
  tenant?: TenantContext;
  actor?: ActorContext;
}

export const CurrentIntegration = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const integration = ctx.switchToHttp().getRequest<ContextualRequest>().integration;
  if (!integration) throw new Error('IntegrationContext ausente: falta ChannelCredentialGuard');
  return integration;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest<ContextualRequest>().tenant;
  if (!tenant) throw new Error('TenantContext ausente: falta SessionGuard');
  return tenant;
});

/** Usuario y membresía de la empresa activa (`SessionGuard`). */
export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const actor = ctx.switchToHttp().getRequest<ContextualRequest>().actor;
  if (!actor) throw new Error('ActorContext ausente: falta SessionGuard');
  return actor;
});

/** Sesión del usuario, con o sin empresa activa (`UserSessionGuard` o `SessionGuard`). */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const session = ctx.switchToHttp().getRequest<ContextualRequest>().session;
  if (!session) throw new Error('SessionContext ausente: falta UserSessionGuard');
  return session;
});
