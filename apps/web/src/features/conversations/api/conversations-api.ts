import {
  ConversationSummarySchema,
  ConversationCommandRejectedSchema,
  InboxCountsResponseSchema,
  ListConversationsResponseSchema,
  ListInboxChannelsResponseSchema,
  ListTimelineResponseSchema,
  SendAgentMessageResponseSchema,
  type ConversationSummary,
  type Inbox,
  type InboxCountsResponse,
  type ListConversationsResponse,
  type ListInboxChannelsResponse,
  type ListTimelineResponse,
  type Message,
} from '@omnidesk/contracts';
import { ApiHttpError, getJson, postJson } from '@/shared/api/http-client';

export async function fetchInboxChannels(): Promise<ListInboxChannelsResponse> {
  const { status, body } = await getJson('/api/v1/channels/inbox');
  if (status !== 200) throw new ApiHttpError(status);
  return ListInboxChannelsResponseSchema.parse(body);
}

export async function fetchConversations(
  inbox: Inbox,
  q: string | undefined,
  channelId: string | undefined,
  cursor?: string,
): Promise<ListConversationsResponse> {
  const query = new URLSearchParams({
    inbox,
    ...(q && { q }),
    ...(channelId && { channelId }),
    ...(cursor && { cursor }),
  });
  const { status, body } = await getJson(`/api/v1/conversations?${query}`);
  if (status !== 200) throw new ApiHttpError(status);
  return ListConversationsResponseSchema.parse(body);
}

/** Conversaciones por bandeja (sin `closed`); `all` solo para OWNER/ADMIN. */
export async function fetchInboxCounts(
  channelId: string | undefined,
): Promise<InboxCountsResponse> {
  const query = new URLSearchParams(channelId ? { channelId } : {});
  const { status, body } = await getJson(`/api/v1/conversations/counts?${query}`);
  if (status !== 200) throw new ApiHttpError(status);
  return InboxCountsResponseSchema.parse(body);
}

/** Lanza `ApiHttpError(404)` si la conversación no existe o el actor no puede verla. */
export async function fetchConversation(conversationId: string): Promise<ConversationSummary> {
  const { status, body } = await getJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
  );
  if (status !== 200) throw new ApiHttpError(status);
  return ConversationSummarySchema.parse(body);
}

/** Mensajes y eventos intercalados. Lanza `ApiHttpError(404)` si el actor no puede ver la conversación. */
export async function fetchTimeline(
  conversationId: string,
  before?: number,
): Promise<ListTimelineResponse> {
  const query = new URLSearchParams(before ? { before: String(before) } : {});
  const { status, body } = await getJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/timeline?${query}`,
  );
  if (status !== 200) throw new ApiHttpError(status);
  return ListTimelineResponseSchema.parse(body);
}

export type ConversationCommandName = 'assign' | 'release' | 'close' | 'reopen';

/** El comando no se aplicó. `reason` solo viene en los `409`. */
export class ConversationCommandError extends ApiHttpError {
  constructor(
    status: number,
    readonly reason?: 'CONTROL_CHANGED' | 'INVALID_STATE',
  ) {
    super(status);
    this.name = 'ConversationCommandError';
  }
}

export async function postConversationCommand(
  conversationId: string,
  command: ConversationCommandName,
  payload: { controlVersion: number; memberId?: string },
): Promise<ConversationSummary> {
  const { status, body } = await postJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/${command}`,
    payload,
  );
  if (status === 200) return ConversationSummarySchema.parse(body);
  const rejected = ConversationCommandRejectedSchema.safeParse(body);
  throw new ConversationCommandError(status, rejected.success ? rejected.data.reason : undefined);
}

/** El envío o el reintento no se aplicó. */
export class SendMessageError extends ApiHttpError {
  constructor(status: number) {
    super(status);
    this.name = 'SendMessageError';
  }
}

/**
 * Registra el mensaje del agente (`PENDING`); el API lo envía por el Outbox. Es idempotente por
 * `clientMessageId`: repetir la petición tras un error de red no duplica el mensaje.
 */
export async function postAgentMessage(
  conversationId: string,
  payload: { text: string; clientMessageId: string },
): Promise<Message> {
  const { status, body } = await postJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    payload,
  );
  if (status === 200 || status === 201) return SendAgentMessageResponseSchema.parse(body);
  throw new SendMessageError(status);
}

/** Devuelve un mensaje `FAILED` a `PENDING` para que el API lo envíe de nuevo. */
export async function postRetryMessage(
  conversationId: string,
  messageId: string,
): Promise<Message> {
  const { status, body } = await postJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/retry`,
    undefined,
  );
  if (status === 200) return SendAgentMessageResponseSchema.parse(body);
  throw new SendMessageError(status);
}
