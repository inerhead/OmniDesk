import { describe, expect, it } from 'vitest';
import { routeTemplate, statusClass } from './http-metrics.middleware';

describe('routeTemplate', () => {
  it('usa la plantilla de la ruta, no la URL', () => {
    expect(routeTemplate({ baseUrl: '', route: { path: '/api/v1/conversations/:id' } })).toBe(
      '/api/v1/conversations/:id',
    );
  });

  it('sin ruta resuelta, o con el comodín de 404 de Nest, devuelve unmatched', () => {
    expect(routeTemplate({ baseUrl: '' })).toBe('unmatched');
    expect(routeTemplate({ baseUrl: '', route: { path: '/api{/*splat}' } })).toBe('unmatched');
  });
});

describe('statusClass', () => {
  it('agrupa por centena', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
  });
});
