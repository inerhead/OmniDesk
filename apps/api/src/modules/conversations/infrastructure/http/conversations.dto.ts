import {
  ListConversationsQuerySchema,
  ListConversationsResponseSchema,
  ListMessagesQuerySchema,
  ListMessagesResponseSchema,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';

export class ListConversationsQueryDto extends createZodDto(ListConversationsQuerySchema) {}
export class ListConversationsResponseDto extends createZodDto(ListConversationsResponseSchema) {}
export class ListMessagesQueryDto extends createZodDto(ListMessagesQuerySchema) {}
export class ListMessagesResponseDto extends createZodDto(ListMessagesResponseSchema) {}
