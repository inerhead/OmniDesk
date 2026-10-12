import { ListMembersResponseSchema } from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';

export class ListMembersResponseDto extends createZodDto(ListMembersResponseSchema) {}
