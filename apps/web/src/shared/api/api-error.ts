import { ApiErrorSchema, type ApiErrorCode } from '@omnidesk/contracts';
import { ApiHttpError } from './http-client';

/** Error del API con su `code` (`ApiErrorSchema`), si lo trae. */
export class ApiCodeError extends ApiHttpError {
  constructor(
    status: number,
    readonly code?: ApiErrorCode,
  ) {
    super(status);
    this.name = 'ApiCodeError';
  }
}

export function apiCodeError(status: number, body: unknown): ApiCodeError {
  const parsed = ApiErrorSchema.safeParse(body);
  return new ApiCodeError(status, parsed.success ? parsed.data.code : undefined);
}

export function isStatus(error: unknown, status: number): boolean {
  return error instanceof ApiHttpError && error.status === status;
}
