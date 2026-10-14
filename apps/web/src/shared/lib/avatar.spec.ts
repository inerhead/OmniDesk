import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor, avatarSrc, initials } from './avatar';

describe('initials', () => {
  it('toma la primera letra de las dos primeras palabras', () => {
    expect(initials('Juan Pérez', '+573001234567')).toBe('JP');
    expect(initials('ana maría lópez', '')).toBe('AM');
  });

  it('con una sola palabra usa sus dos primeras letras', () => {
    expect(initials('Laura', '')).toBe('LA');
    expect(initials('Ñ', '')).toBe('Ñ');
  });

  it('sin nombre usa el respaldo; un teléfono sin letras da "#"', () => {
    expect(initials(null, '+573001234567')).toBe('#');
    expect(initials('   ', 'Mateo')).toBe('MA');
  });

  it('ignora palabras sin letras', () => {
    expect(initials('Cliente 2 Sur', '')).toBe('CS');
  });
});

describe('avatarColor', () => {
  it('es determinista', () => {
    const id = '0199c0de-0000-7000-8000-000000000001';
    expect(avatarColor(id)).toBe(avatarColor(id));
  });

  it('siempre devuelve uno de los 8 colores y reparte ids distintos', () => {
    const colors = new Set(
      Array.from({ length: 200 }, (_, index) => avatarColor(`contact-${index}`)),
    );
    for (const color of colors) expect(AVATAR_COLORS).toContain(color);
    expect(colors.size).toBe(8);
  });
});

describe('avatarSrc', () => {
  it('antepone la base a la foto subida', () => {
    expect(avatarSrc('/api/v1/users/u1/avatar?v=1', '/omnidesk')).toBe(
      '/omnidesk/api/v1/users/u1/avatar?v=1',
    );
  });

  it('deja la de Google tal cual y sin foto devuelve null', () => {
    expect(avatarSrc('https://lh3.googleusercontent.com/a/x', '/omnidesk')).toBe(
      'https://lh3.googleusercontent.com/a/x',
    );
    expect(avatarSrc(null, '/omnidesk')).toBeNull();
    expect(avatarSrc(undefined, '')).toBeNull();
  });
});
