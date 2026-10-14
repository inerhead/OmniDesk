import { pipeline } from 'node:stream/promises';
import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { GetAttachmentContentUseCase } from '../../application/get-attachment-content.use-case';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../application/ports/attachment-storage';
import { parseRange } from '../../domain/byte-range';
import { contentDisposition } from '../../domain/file-name';

@ApiTags('attachments')
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'attachments', version: '1' })
export class AttachmentsController {
  constructor(
    private readonly getContent: GetAttachmentContentUseCase,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  /** Mismo origen que la web: `<img>`, `<video>` y `<audio>` envían la cookie de sesión. */
  @Get(':id/content')
  @ApiNotFoundResponse({ description: 'No existe, no está listo o no puedes ver la conversación.' })
  async content(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.getContent.execute(actor, id);
    if (!attachment) throw new NotFoundException('Adjunto no encontrado');
    const size = attachment.sizeBytes;
    const range = parseRange(rangeHeader, size);
    res.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    if (range === 'invalid') {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    const object = await this.storage.get(attachment.storageKey, range ?? undefined);
    res.status(range ? 206 : 200).set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(range ? range.end - range.start + 1 : size),
      'Content-Disposition': contentDisposition(attachment.mimeType, attachment.fileName),
      ...(range && { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }),
    });
    await pipeline(object.body, res);
  }
}
