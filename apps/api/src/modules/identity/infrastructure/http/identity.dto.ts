import {
  AuthProvidersResponseSchema,
  DevLoginRequestSchema,
  MeResponseSchema,
  SetActiveTenantRequestSchema,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { MeView } from '../../application/get-me.use-case';

export class MeResponseDto extends createZodDto(MeResponseSchema) {}
export class DevLoginRequestDto extends createZodDto(DevLoginRequestSchema) {}
export class SetActiveTenantRequestDto extends createZodDto(SetActiveTenantRequestSchema) {}
export class AuthProvidersResponseDto extends createZodDto(AuthProvidersResponseSchema) {}

export function toMeResponse(me: MeView) {
  return {
    user: {
      id: me.user.id,
      email: me.user.email,
      displayName: me.user.displayName,
      avatarUrl: me.user.avatarUrl,
    },
    memberships: me.memberships,
    activeTenantId: me.activeTenantId,
  };
}
