import {
  ConversationSummarySchema,
  ConversationCommandRejectedSchema,
  DEMO_MEMBER_HEADER,
  ListConversationsResponseSchema,
  ListTimelineResponseSchema,
  type ConversationSummary,
  type Inbox,
  type ListConversationsResponse,
  type ListTimelineResponse,
} from '@omnidesk/contracts';
import { ApiHttpError, getJson, postJson } from '@/shared/api/http-client';

/** Hasta el spec de identidad, el API sabe quién actúa por esta cabecera. */
const asActor = (actorId: string) => ({ headers: { [DEMO_MEMBER_HEADER]: actorId } });

export async function fetchConversations(
  actorId: string,
  inbox: Inbox,
  cursor?: string,
): Promise<ListConversationsResponse> {
  const query = new URLSearchParams({ inbox, ...(cursor && { cursor }) });
  const { status, body } = await getJson(`/api/v1/conversations?${query}`, asActor(actorId));
  if (status !== 200) throw new ApiHttpError(status);
  return ListConversationsResponseSchema.parse(body);
}

/** Lanza `ApiHttpError(404)` si la conversación no existe o el actor no puede verla. */
export async function fetchConversation(
  actorId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  const { status, body } = await getJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
    asActor(actorId),
  );
  if (status !== 200) throw new ApiHttpError(status);
  return ConversationSummarySchema.parse(body);
}

/** Mensajes y eventos intercalados. Lanza `ApiHttpError(404)` si el actor no puede ver la conversación. */
export async function fetchTimeline(
  actorId: string,
  conversationId: string,
  before?: number,
): Promise<ListTimelineResponse> {
  const query = new URLSearchParams(before ? { before: String(before) } : {});
  const { status, body } = await getJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/timeline?${query}`,
    asActor(actorId),
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
  actorId: string,
  conversationId: string,
  command: ConversationCommandName,
  payload: { controlVersion: number; memberId?: string },
): Promise<ConversationSummary> {
  const { status, body } = await postJson(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/${command}`,
    payload,
    asActor(actorId),
  );
  if (status === 200) return ConversationSummarySchema.parse(body);
  const rejected = ConversationCommandRejectedSchema.safeParse(body);
  throw new ConversationCommandError(status, rejected.success ? rejected.data.reason : undefined);
}
