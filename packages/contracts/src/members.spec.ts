import { describe, expect, it } from 'vitest';
import { ListMembersResponseSchema, MemberSchema } from './members';

describe('MemberSchema', () => {
  const member = {
    id: '0199c0de-0000-7000-8000-000000000002',
    displayName: 'Laura',
    email: 'laura@demo.omnidesk.local',
    role: 'AGENT',
  };

  it('acepta un miembro válido con su email (SPEC 17)', () => {
    expect(MemberSchema.parse(member)).toEqual({ ...member, avatarUrl: null });
  });

  it('exige un email válido', () => {
    expect(MemberSchema.safeParse({ ...member, email: undefined }).success).toBe(false);
    expect(MemberSchema.safeParse({ ...member, email: 'laura' }).success).toBe(false);
  });

  it('conserva la foto si viene', () => {
    const avatarUrl = '/api/v1/users/u1/avatar?v=1';
    expect(MemberSchema.parse({ ...member, avatarUrl }).avatarUrl).toBe(avatarUrl);
  });

  it('rechaza un rol desconocido y un id que no es uuid', () => {
    expect(MemberSchema.safeParse({ ...member, role: 'GUEST' }).success).toBe(false);
    expect(MemberSchema.safeParse({ ...member, id: 'laura' }).success).toBe(false);
  });

  it('valida la lista', () => {
    expect(ListMembersResponseSchema.safeParse({ items: [member] }).success).toBe(true);
  });
});
