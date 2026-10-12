import {
  DeliveryStatusRequestSchema,
  DeliveryStatusResponseSchema,
  InboundMessageRequestSchema,
  InboundMessageResponseSchema,
  OutboundAiMessageRejectedSchema,
  OutboundAiMessageRequestSchema,
  OutboundAiMessageResponseSchema,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';

export class InboundMessageRequestDto extends createZodDto(InboundMessageRequestSchema) {}
export class InboundMessageResponseDto extends createZodDto(InboundMessageResponseSchema) {}
export class OutboundAiMessageRequestDto extends createZodDto(OutboundAiMessageRequestSchema) {}
export class OutboundAiMessageResponseDto extends createZodDto(OutboundAiMessageResponseSchema) {}
export class OutboundAiMessageRejectedDto extends createZodDto(OutboundAiMessageRejectedSchema) {}
export class DeliveryStatusRequestDto extends createZodDto(DeliveryStatusRequestSchema) {}
export class DeliveryStatusResponseDto extends createZodDto(DeliveryStatusResponseSchema) {}
