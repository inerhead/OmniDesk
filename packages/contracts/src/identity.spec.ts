import { describe, expect, it } from 'vitest';
import {
  AuthProvidersResponseSchema,
  DevLoginRequestSchema,
  MeResponseSchema,
  SetActiveTenantRequestSchema,
} from './auth';
import { ApiErrorSchema } from './errors';
import {
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  InvitationPreviewSchema,
  InvitationSchema,
} from './invitations';
import { UpdateMemberRoleRequestSchema } from './members';
import { CreateTenantRequestSchema } from './tenants';

const uuid = (n: number) => `0199c0de-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('MeResponseSchema', () => {
  const me = {
    user: {
      id: uuid(1),
      email: 'laura@demo.omnidesk.local',
      displayName: 'Laura',
      avatarUrl: null,
    },
    memberships: [
      {
        memberId: uuid(2),
        tenantId: uuid(3),
        tenantName: 'Demo',
        tenantSlug: 'demo',
        role: 'AGENT',
      },
    ],
    activeTenantId: uuid(3),
  };

  it('acepta un usuario con membresías y empresa activa', () => {
    expect(MeResponseSchema.parse(me)).toEqual(me);
  });

  it('acepta un usuario sin membresías ni empresa activa', () => {
    expect(
      MeResponseSchema.safeParse({ ...me, memberships: [], activeTenantId: null }).success,
    ).toBe(true);
  });

  it('rechaza un rol desconocido en una membresía', () => {
    const bad = { ...me, memberships: [{ ...me.memberships[0], role: 'GUEST' }] };
    expect(MeResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('peticiones de sesión', () => {
  it('active-tenant y dev-login exigen un uuid', () => {
    expect(SetActiveTenantRequestSchema.safeParse({ tenantId: uuid(1) }).success).toBe(true);
    expect(SetActiveTenantRequestSchema.safeParse({ tenantId: 'demo' }).success).toBe(false);
    expect(DevLoginRequestSchema.safeParse({ memberId: uuid(1) }).success).toBe(true);
    expect(DevLoginRequestSchema.safeParse({}).success).toBe(false);
  });

  it('providers lista los miembros demo', () => {
    expect(
      AuthProvidersResponseSchema.safeParse({
        google: false,
        demoMembers: [{ memberId: uuid(1), displayName: 'Laura', role: 'AGENT' }],
      }).success,
    ).toBe(true);
  });
});

describe('CreateTenantRequestSchema', () => {
  it('recorta el nombre y acepta un slug en minúsculas con guiones simples', () => {
    expect(CreateTenantRequestSchema.parse({ name: '  Acme  ', slug: 'acme-sur' })).toEqual({
      name: 'Acme',
      slug: 'acme-sur',
    });
  });

  it.each(['Acme', 'ac', 'acme--sur', '-acme', 'acme-', 'acme_sur', 'a'.repeat(41)])(
    'rechaza el slug %s',
    (slug) => {
      expect(CreateTenantRequestSchema.safeParse({ name: 'Acme', slug }).success).toBe(false);
    },
  );

  it('rechaza un nombre de menos de 2 caracteres tras recortar', () => {
    expect(CreateTenantRequestSchema.safeParse({ name: ' A ', slug: 'acme' }).success).toBe(false);
  });
});

describe('invitaciones', () => {
  it('solo se invita a ADMIN o AGENT con un email válido', () => {
    expect(
      CreateInvitationRequestSchema.safeParse({ email: 'a@b.co', role: 'AGENT' }).success,
    ).toBe(true);
    expect(
      CreateInvitationRequestSchema.safeParse({ email: 'a@b.co', role: 'OWNER' }).success,
    ).toBe(false);
    expect(CreateInvitationRequestSchema.safeParse({ email: 'nope', role: 'AGENT' }).success).toBe(
      false,
    );
  });

  it('valida la respuesta, la invitación pendiente y la vista previa', () => {
    expect(
      CreateInvitationResponseSchema.safeParse({
        id: uuid(1),
        url: 'http://localhost:8080/invite/abc',
        expiresAt: '2026-10-19T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      InvitationSchema.safeParse({
        id: uuid(1),
        email: 'nuevo@acme.co',
        role: 'ADMIN',
        invitedBy: { id: uuid(2), displayName: 'Sup. Demo' },
        createdAt: '2026-10-12T10:00:00.000Z',
        expiresAt: '2026-10-19T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      InvitationPreviewSchema.safeParse({
        tenantName: 'Acme',
        role: 'AGENT',
        emailMasked: 'nu***@acme.co',
        expired: false,
      }).success,
    ).toBe(true);
  });
});

describe('UpdateMemberRoleRequestSchema', () => {
  it('acepta los tres roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'AGENT']) {
      expect(UpdateMemberRoleRequestSchema.safeParse({ role }).success).toBe(true);
    }
    expect(UpdateMemberRoleRequestSchema.safeParse({ role: 'GUEST' }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('exige un código conocido', () => {
    expect(
      ApiErrorSchema.safeParse({ statusCode: 409, code: 'LAST_OWNER', message: 'x' }).success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ statusCode: 409, code: 'OTRO', message: 'x' }).success).toBe(
      false,
    );
  });
});
