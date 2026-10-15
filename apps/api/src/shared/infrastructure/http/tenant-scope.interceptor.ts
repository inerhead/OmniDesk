import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runInTenantScope } from '../prisma/tenant-scope';
import type { ContextualRequest } from './request-context.decorators';

/**
 * Atiende cada petición con empresa resuelta (sesión con empresa activa o credencial de
 * integración) en nombre de esa empresa: la base aplica Row Level Security (SPEC 12). Corre después
 * de los guards, que resuelven la sesión y la credencial con el rol dueño.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<ContextualRequest>();
    const tenantId = request.tenant?.tenantId ?? request.integration?.tenantId;
    if (!tenantId) return next.handle();
    // El handler se ejecuta al suscribirse: la suscripción va dentro del contexto.
    return new Observable((subscriber) =>
      runInTenantScope(tenantId, () => next.handle().subscribe(subscriber)),
    );
  }
}
