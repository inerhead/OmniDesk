import { TenantSlugSchema } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { loginPathFor, safeNextPath } from './next-path';
import { slugify } from './slugify';

describe('safeNextPath', () => {
  it('acepta rutas internas', () => {
    expect(safeNextPath('/conversations?inbox=mine')).toBe('/conversations?inbox=mine');
  });

  it.each([null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'conversations'])(
    'descarta %s',
    (next) => {
      expect(safeNextPath(next)).toBeNull();
    },
  );
});

describe('loginPathFor', () => {
  it('codifica la ruta actual en next', () => {
    expect(loginPathFor('/conversations')).toBe('/login?next=%2Fconversations');
    expect(loginPathFor('/conversations/1?inbox=ai')).toBe(
      '/login?next=%2Fconversations%2F1%3Finbox%3Dai',
    );
  });

  it('no anida /login', () => {
    expect(loginPathFor('/login?next=%2Fstatus')).toBe('/login?next=%2Fstatus');
  });
});

describe('slugify', () => {
  it('quita tildes y símbolos y une con guiones simples', () => {
    expect(slugify('Óptica Núñez & Cía')).toBe('optica-nunez-cia');
    expect(slugify('  Acme  ')).toBe('acme');
    expect(slugify('A--B__C')).toBe('a-b-c');
  });

  it('produce slugs que acepta el API', () => {
    for (const name of ['Óptica Núñez & Cía', 'Empresa Demo 2026', 'x'.repeat(60)]) {
      expect(TenantSlugSchema.safeParse(slugify(name)).success).toBe(true);
    }
  });
});
