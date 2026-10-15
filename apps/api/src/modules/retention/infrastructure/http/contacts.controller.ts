import {
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { DeleteContactUseCase } from '../../application/delete-contact.use-case';

@ApiTags('contacts')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'contacts', version: '1' })
export class ContactsController {
  constructor(private readonly deleteContact: DeleteContactUseCase) {}

  /** Borra el contacto y todo su historial (SPEC 12). Irreversible. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Contacto, conversaciones, mensajes y eventos borrados.' })
  @ApiForbiddenResponse({ description: 'No es OWNER de la empresa activa.' })
  @ApiNotFoundResponse({ description: 'El contacto no existe en la empresa activa.' })
  async delete(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const result = await this.deleteContact.execute(actor, id);
    if (result.kind === 'forbidden')
      throw new ForbiddenException('Solo un Owner puede borrar contactos');
    if (result.kind === 'not-found') throw new NotFoundException('Contacto no encontrado');
  }
}
