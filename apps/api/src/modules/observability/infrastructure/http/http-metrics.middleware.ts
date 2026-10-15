import type { NextFunction, Request, Response } from 'express';
import type { PromMetrics } from '../prom-metrics';

/**
 * Ruta de plantilla (`/api/v1/conversations/:id`), nunca la URL real. Sin ruta, o con el comodín con
 * el que Nest responde 404 (`/api{/*splat}`), `unmatched`.
 */
export function routeTemplate(request: Pick<Request, 'baseUrl'> & { route?: { path?: unknown } }) {
  const path = request.route?.path;
  if (typeof path !== 'string' || path.includes('*')) return 'unmatched';
  return `${request.baseUrl ?? ''}${path}`;
}

/** `2xx`, `4xx`… */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Latencia de cada petición HTTP (SPEC 11). Es un middleware y no un interceptor para ver también
 * las peticiones que no llegan a ningún handler (404 de ruta inexistente), con `route="unmatched"`.
 * La ruta se lee al terminar: Express la resuelve después de este middleware.
 */
export function httpMetricsMiddleware(metrics: PromMetrics) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const stop = metrics.httpRequestDuration.startTimer();
    response.on('finish', () => {
      stop({
        method: request.method,
        route: routeTemplate(request),
        status_class: statusClass(response.statusCode),
      });
    });
    next();
  };
}
