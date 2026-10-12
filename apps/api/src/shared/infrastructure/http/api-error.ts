import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@omnidesk/contracts';

/** Error HTTP con `code` (`ApiErrorSchema`): la web decide por el código, no por el texto. */
export function apiError(status: HttpStatus, code: ApiErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}
