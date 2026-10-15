import {
  Inject,
  Injectable,
  Optional,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, type Observable, tap, throwError } from 'rxjs';
import { METRICS, type Metrics } from '../../../../shared/application/metrics.port';
import { integrationEndpoint } from '../../../../shared/infrastructure/http/integration-endpoint';

/**
 * Cuenta las peticiones de integración que pasan la credencial (SPEC 11): `ok` con respuesta 2xx y
 * `rejected` con 4xx/5xx o una excepción. Las que no la pasan las cuenta `ChannelCredentialGuard`.
 */
@Injectable()
export class IntegrationMetricsInterceptor implements NestInterceptor {
  constructor(@Optional() @Inject(METRICS) private readonly metrics?: Metrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const endpoint = integrationEndpoint(http.getRequest<Request>().path);
    if (!endpoint || !this.metrics) return next.handle();
    const metrics = this.metrics;
    return next.handle().pipe(
      tap(() => {
        const status = http.getResponse<Response>().statusCode;
        metrics.integrationRequest(endpoint, status < 400 ? 'ok' : 'rejected');
      }),
      catchError((error: unknown) => {
        metrics.integrationRequest(endpoint, 'rejected');
        return throwError(() => error);
      }),
    );
  }
}
