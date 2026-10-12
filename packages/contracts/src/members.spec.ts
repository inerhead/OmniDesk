import { describe, expect, it } from 'vitest';
import { ListMembersResponseSchema, MemberSchema } from './members';

describe('MemberSchema', () => {
  const member = {
    id: '0199c0de-0000-7000-8000-000000000002',
    displayName: 'Laura',
    role: 'AGENT',
  };

  it('acepta un miembro válido y no expone el email', () => {
    expect(MemberSchema.parse({ ...member, email: 'laura@demo.omnidesk.local' })).toEqual(member);
  });

  it('rechaza un rol desconocido y un id que no es uuid', () => {
    expect(MemberSchema.safeParse({ ...member, role: 'GUEST' }).success).toBe(false);
    expect(MemberSchema.safeParse({ ...member, id: 'laura' }).success).toBe(false);
  });

  it('valida la lista', () => {
    expect(ListMembersResponseSchema.safeParse({ items: [member] }).success).toBe(true);
  });
});
