import { z } from 'zod';
import { AvatarUrlSchema } from './profile';

export const MemberRoleSchema = z.enum(['OWNER', 'ADMIN', 'AGENT']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MemberSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: MemberRoleSchema,
  avatarUrl: AvatarUrlSchema,
});
export type Member = z.infer<typeof MemberSchema>;

/** `GET /api/v1/members` */
export const ListMembersResponseSchema = z.object({ items: z.array(MemberSchema) });
export type ListMembersResponse = z.infer<typeof ListMembersResponseSchema>;

/** `PATCH /api/v1/members/:id` (solo OWNER). */
export const UpdateMemberRoleRequestSchema = z.object({ role: MemberRoleSchema });
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequestSchema>;
