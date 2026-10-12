import { describe, expect, it } from 'vitest';
import { publicPath, publicUrl } from './public-url';

describe('publicUrl', () => {
  it('conserva la subruta de APP_URL', () => {
    expect(publicUrl('https://dev.gastromesa.com/omnidesk', '/login?error=oauth')).toBe(
      'https://dev.gastromesa.com/omnidesk/login?error=oauth',
    );
  });

  it('acepta APP_URL con barra final y rutas sin barra inicial', () => {
    expect(publicUrl('https://gastromesa.com/omnidesk/', 'invite/abc')).toBe(
      'https://gastromesa.com/omnidesk/invite/abc',
    );
  });

  it('funciona en la raíz', () => {
    expect(publicUrl('http://localhost:8080', '/conversations')).toBe(
      'http://localhost:8080/conversations',
    );
  });
});

describe('publicPath', () => {
  it('antepone la subruta', () => {
    expect(publicPath('/omnidesk', '/api/v1/auth/google')).toBe('/omnidesk/api/v1/auth/google');
  });

  it('en la raíz la subruta vacía da "/"', () => {
    expect(publicPath('', '')).toBe('/');
    expect(publicPath('/omnidesk', '')).toBe('/omnidesk');
  });
});
