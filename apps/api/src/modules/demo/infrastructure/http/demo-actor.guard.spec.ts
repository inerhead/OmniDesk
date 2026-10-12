import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { DEMO_MEMBER_HEADER } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../../shared/config/env';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import type { MemberRepository } from '../../../members/application/ports/member.repository';
import type { Member } from '../../../members/domain/member';
import type { TenantRepository } from '../../../tenancy/application/ports/tenant.repository';
import { DemoActorGuard } from './demo-actor.guard';

const LAURA_ID = '0199c0de-0000-7000-8000-000000000002';
const laura: Member = {
  id: LAURA_ID,
  tenantId: 'demo-tenant',
  displayName: 'Laura',
  email: 'laura@demo.omnidesk.local',
  role: 'AGENT',
};

function setup({ demoMode = true, tenantExists = true, members = [laura] } = {}) {
  const tenants = {
    findBySlug: async () =>
      tenantExists ? { id: 'demo-tenant', slug: 'demo', name: 'Demo' } : null,
  } as unknown as TenantRepository;
  const memberRepo = {
    findById: async (tenantId: string, id: string) =>
      members.find((m) => m.id === id && m.tenantId === tenantId) ?? null,
  } as unknown as MemberRepository;
  const guard = new DemoActorGuard({ DEMO_MODE: demoMode } as Env, tenants, memberRepo);

  const run = async (headers: Record<string, string> = {}) => {
    const request = {
      header: (name: string) => headers[name],
    } as unknown as ContextualRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const allowed = await guard.canActivate(context);
    return { allowed, request };
  };
  return { run };
}

describe('DemoActorGuard', () => {
  it('deja tenant y actor en la petición para un miembro del tenant demo', async () => {
    const { run } = setup();

    const { allowed, request } = await run({ [DEMO_MEMBER_HEADER]: LAURA_ID });

    expect(allowed).toBe(true);
    expect(request.tenant).toEqual({ tenantId: 'demo-tenant' });
    expect(request.actor).toEqual({ tenantId: 'demo-tenant', memberId: LAURA_ID, role: 'AGENT' });
  });

  it('responde 401 "Selecciona con quién actuar" sin la cabecera', async () => {
    const { run } = setup();

    await expect(run()).rejects.toThrow(new UnauthorizedException('Selecciona con quién actuar'));
  });

  it('responde 401 con un id que no es uuid', async () => {
    const { run } = setup();

    await expect(run({ [DEMO_MEMBER_HEADER]: 'laura' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 401 con un miembro que no es del tenant demo', async () => {
    const { run } = setup({ members: [{ ...laura, tenantId: 'otro-tenant' }] });

    await expect(run({ [DEMO_MEMBER_HEADER]: LAURA_ID })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 401 con DEMO_MODE=false', async () => {
    const { run } = setup({ demoMode: false });

    await expect(run({ [DEMO_MEMBER_HEADER]: LAURA_ID })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('responde 503 si el tenant demo no está sembrado', async () => {
    const { run } = setup({ tenantExists: false });

    await expect(run({ [DEMO_MEMBER_HEADER]: LAURA_ID })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
