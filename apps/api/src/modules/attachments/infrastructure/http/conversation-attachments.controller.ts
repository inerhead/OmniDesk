import {
  BadRequestException,
  Body,
  Catch,
  ConflictException,
  Controller,
  type ExceptionFilter,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ArgumentsHost,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  MAX_OUTBOUND_ATTACHMENT_BYTES,
  SendAgentAttachmentFieldsSchema,
  type OutboundAttachmentRejection,
  type SendAgentMessageResponse,
} from '@omnidesk/contracts';
import type { Response } from 'express';
import { memoryStorage, MulterError } from 'multer';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { toMessageDto } from '../../../conversations/infrastructure/http/message.mapper';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { SendAgentAttachmentUseCase } from '../../application/send-agent-attachment.use-case';
import { decodeMultipartFileName } from '../../domain/file-name';

class SendAgentAttachmentFieldsDto extends createZodDto(SendAgentAttachmentFieldsSchema) {}

/** Multer responde 500 al superar el límite; el contrato de este endpoint es 413. */
@Catch(MulterError)
class AttachmentUploadExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error.code === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        message: 'El archivo supera el tamaño permitido',
      });
      return;
    }
    response.status(HttpStatus.BAD_REQUEST).json({ message: error.message });
  }
}

const REJECTIONS: Record<OutboundAttachmentRejection, () => Error> = {
  UNSUPPORTED_TYPE: () => new UnsupportedMediaTypeException('Tipo de archivo no admitido'),
  TOO_LARGE: () => new PayloadTooLargeException('El archivo supera el tamaño permitido'),
  EMPTY: () => new BadRequestException('El archivo está vacío'),
  CAPTION_NOT_ALLOWED: () => new BadRequestException('Los audios se envían sin texto'),
  CAPTION_TOO_LONG: () => new BadRequestException('El texto admite hasta 1024 caracteres'),
};

@ApiTags('conversations')
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'conversations', version: '1' })
export class ConversationAttachmentsController {
  constructor(private readonly sendAttachment: SendAgentAttachmentUseCase) {}

  /** Un archivo por mensaje; `caption` es su texto. Multer responde 413 si supera 16 MB. */
  @Post(':id/messages/attachments')
  @UseFilters(AttachmentUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      // Sin esto multer escribe a disco y `file.buffer` llega vacío.
      storage: memoryStorage(),
      limits: { fileSize: MAX_OUTBOUND_ATTACHMENT_BYTES, files: 1, fields: 5 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  async send(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: SendAgentAttachmentFieldsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SendAgentMessageResponse> {
    if (!file) throw new BadRequestException('Falta el archivo');
    const result = await this.sendAttachment.execute(actor, {
      conversationId: id,
      clientMessageId: body.clientMessageId,
      caption: body.caption,
      file: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        fileName: decodeMultipartFileName(file.originalname),
        sizeBytes: file.size,
      },
    });
    switch (result.kind) {
      case 'invalid':
        throw REJECTIONS[result.reason]();
      case 'not-found':
        throw new NotFoundException('Conversación no encontrada');
      case 'forbidden':
        throw new ForbiddenException('Solo el agente asignado puede responder');
      case 'rejected':
        throw new ConflictException({ reason: result.reason });
      case 'ok':
        res.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
        return toMessageDto(result.message);
    }
  }
}
