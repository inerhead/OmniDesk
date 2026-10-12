import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type {
  ActorContext,
  IntegrationContext,
  TenantContext,
} from '../../application/request-context';

/** Los guards guardan aquí el contexto resuelto; los controladores lo leen con los decoradores. */
export interface ContextualRequest extends Request {
  integration?: IntegrationContext;
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
  if (!tenant) throw new Error('TenantContext ausente: falta un guard de tenant');
  return tenant;
});

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const actor = ctx.switchToHttp().getRequest<ContextualRequest>().actor;
  if (!actor) throw new Error('ActorContext ausente: falta DemoActorGuard');
  return actor;
});
