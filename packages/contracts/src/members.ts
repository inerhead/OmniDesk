import { z } from 'zod';

/** Cabecera con la que la web dice con qué miembro actúa (solo `DEMO_MODE=true`, hasta el spec de identidad). */
export const DEMO_MEMBER_HEADER = 'X-Demo-Member-Id';

export const MemberRoleSchema = z.enum(['OWNER', 'ADMIN', 'AGENT']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MemberSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: MemberRoleSchema,
});
export type Member = z.infer<typeof MemberSchema>;

/** `GET /api/v1/members` */
export const ListMembersResponseSchema = z.object({ items: z.array(MemberSchema) });
export type ListMembersResponse = z.infer<typeof ListMembersResponseSchema>;
