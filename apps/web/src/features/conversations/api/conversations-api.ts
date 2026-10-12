import {
  ListConversationsResponseSchema,
  ListMessagesResponseSchema,
  type ListConversationsResponse,
  type ListMessagesResponse,
} from '@omnidesk/contracts';
import { ApiHttpError, getJson } from '@/shared/api/http-client';

export async function fetchConversations(cursor?: string): Promise<ListConversationsResponse> {
  const query = new URLSearchParams(cursor ? { cursor } : {});
  const { status, body } = await getJson(`/api/v1/conversations?${query}`);
  if (status !== 200) throw new ApiHttpError(status);
  return ListConversationsResponseSchema.parse(body);
}

/** Lanza `ApiHttpError(404)` si la conversación no existe. */
export async function fetchMessages(
  conversationId: string,
  before?: number,
): Promise<ListMessagesResponse> {
  const query = new URLSearchParams(before ? { before: String(before) } : {});
  const { status, body } = await getJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
  );
  if (status !== 200) throw new ApiHttpError(status);
  return ListMessagesResponseSchema.parse(body);
}
