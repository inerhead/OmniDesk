import { HealthLiveResponseSchema, HealthResponseSchema } from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';

/** DTO de Swagger generado desde el contrato compartido: una sola fuente de verdad. */
export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
export class HealthLiveResponseDto extends createZodDto(HealthLiveResponseSchema) {}
