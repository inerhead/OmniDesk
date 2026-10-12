import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MemberSchema, UpdateMemberRoleRequestSchema, type Member } from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import {
  RemoveMemberUseCase,
  UpdateMemberRoleUseCase,
  type MemberCommandResult,
} from '../../application/members.use-cases';

class UpdateMemberRoleRequestDto extends createZodDto(UpdateMemberRoleRequestSchema) {}
class MemberDto extends createZodDto(MemberSchema) {}

function unwrap<T>(result: MemberCommandResult<T>): T {
  switch (result.kind) {
    case 'ok':
      return result.value;
    case 'forbidden':
      throw new ForbiddenException('Tu rol no permite esta acción');
    case 'not-found':
      throw new NotFoundException('Miembro no encontrado');
    case 'last-owner':
      throw apiError(HttpStatus.CONFLICT, 'LAST_OWNER', 'La empresa debe tener al menos un OWNER');
  }
}

/** Cambio de rol y baja de miembros de la empresa activa. La lista está en `MembersController`. */
@ApiTags('members')
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'members', version: '1' })
export class TeamMembersController {
  constructor(
    private readonly updateRole: UpdateMemberRoleUseCase,
    private readonly removeMember: RemoveMemberUseCase,
  ) {}

  @Patch(':id')
  @ApiOkResponse({ type: MemberDto.Output })
  @ApiForbiddenResponse({ description: 'Solo OWNER cambia roles.' })
  @ApiConflictResponse({ description: 'Degradaría al último OWNER (`LAST_OWNER`).' })
  async changeRole(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMemberRoleRequestDto,
  ): Promise<Member> {
    const { displayName, role } = unwrap(await this.updateRole.execute(actor, id, body.role));
    return { id, displayName, role };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Baja lógica: revoca sus sesiones y devuelve sus conversaciones a la IA.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN solo quita AGENT; AGENT no quita a nadie.' })
  @ApiConflictResponse({ description: 'Es el último OWNER (`LAST_OWNER`).' })
  async remove(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    unwrap(await this.removeMember.execute(actor, id));
  }
}
