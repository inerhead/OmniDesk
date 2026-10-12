import {
  AssignConversationRequestSchema,
  ConversationCommandRejectedSchema,
  ConversationSummarySchema,
  ConversationCommandRequestSchema,
  ConversationCommandResponseSchema,
  ListConversationsQuerySchema,
  ListConversationsResponseSchema,
  ListMessagesQuerySchema,
  ListMessagesResponseSchema,
  ListTimelineQuerySchema,
  ListTimelineResponseSchema,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';

export class ListConversationsQueryDto extends createZodDto(ListConversationsQuerySchema) {}
export class ListConversationsResponseDto extends createZodDto(ListConversationsResponseSchema) {}
export class ConversationSummaryDto extends createZodDto(ConversationSummarySchema) {}
export class ListMessagesQueryDto extends createZodDto(ListMessagesQuerySchema) {}
export class ListMessagesResponseDto extends createZodDto(ListMessagesResponseSchema) {}
export class ListTimelineQueryDto extends createZodDto(ListTimelineQuerySchema) {}
export class ListTimelineResponseDto extends createZodDto(ListTimelineResponseSchema) {}
export class AssignConversationRequestDto extends createZodDto(AssignConversationRequestSchema) {}
export class ConversationCommandRequestDto extends createZodDto(ConversationCommandRequestSchema) {}
export class ConversationCommandResponseDto extends createZodDto(
  ConversationCommandResponseSchema,
) {}
export class ConversationCommandRejectedDto extends createZodDto(
  ConversationCommandRejectedSchema,
) {}
