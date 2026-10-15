import { Catch, type ArgumentsHost, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_UPLOAD_MAX_BYTES } from '@omnidesk/contracts';
import type { Response } from 'express';
import { memoryStorage, MulterError } from 'multer';

/** Multer responde 500 al superar el límite; el contrato de las subidas de imagen es 413. */
@Catch(MulterError)
export class ImageUploadExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error.code === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ message: 'La imagen supera 1 MB' });
      return;
    }
    response.status(HttpStatus.BAD_REQUEST).json({ message: error.message });
  }
}

/** Un archivo `file` de hasta 1 MB, en memoria (foto de perfil y logo de empresa). */
export const ImageUploadInterceptor = FileInterceptor('file', {
  // Sin esto multer escribe a disco y `file.buffer` llega vacío.
  storage: memoryStorage(),
  limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
});

/** Cabeceras de una imagen servida por el API: `?v=` cambia con cada subida. */
export const IMAGE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, max-age=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
} as const;
