import { describe, expect, it } from 'vitest';
import { navItemLabel } from './nav-item-label';
import { NAV_ITEMS } from './nav-items';

const [conversations, status] = NAV_ITEMS as [
  (typeof NAV_ITEMS)[number],
  (typeof NAV_ITEMS)[number],
];

describe('navItemLabel', () => {
  it('con aviso pendiente, Conversaciones se anuncia con mensajes nuevos', () => {
    expect(navItemLabel(conversations, { kind: 'pending' })).toBe(
      'Conversaciones, mensajes nuevos',
    );
  });

  it('sin aviso, o con una pasada dentro de Conversaciones, el nombre de siempre', () => {
    expect(navItemLabel(conversations, { kind: 'idle' })).toBe('Conversaciones');
    expect(navItemLabel(conversations, { kind: 'pulse', seq: 1 })).toBe('Conversaciones');
  });

  it('el aviso no cambia otros destinos', () => {
    expect(navItemLabel(status, { kind: 'pending' })).toBe('Estado');
  });
});
