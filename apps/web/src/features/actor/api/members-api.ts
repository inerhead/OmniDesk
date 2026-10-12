import { ListMembersResponseSchema, type ListMembersResponse } from '@omnidesk/contracts';
import { ApiHttpError, getJson } from '@/shared/api/http-client';

export async function fetchMembers(): Promise<ListMembersResponse> {
  const { status, body } = await getJson('/api/v1/members');
  if (status !== 200) throw new ApiHttpError(status);
  return ListMembersResponseSchema.parse(body);
}
