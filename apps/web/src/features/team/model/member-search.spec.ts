import { describe, expect, it } from 'vitest';
import { filterMembers } from './member-search';

const members = [
  { displayName: 'José Pérez', email: 'jose@acme.co' },
  { displayName: 'Laura Gómez', email: 'laura.g@acme.co' },
  { displayName: 'Mateo', email: 'mateo@otra.co' },
];

describe('filterMembers', () => {
  it('encuentra por nombre sin distinguir mayúsculas ni tildes', () => {
    expect(filterMembers(members, 'jose').map((m) => m.displayName)).toEqual(['José Pérez']);
    expect(filterMembers(members, 'GÓMEZ').map((m) => m.displayName)).toEqual(['Laura Gómez']);
  });

  it('encuentra por parte del email', () => {
    expect(filterMembers(members, 'otra.co').map((m) => m.displayName)).toEqual(['Mateo']);
    expect(filterMembers(members, 'acme')).toHaveLength(2);
  });

  it('una búsqueda vacía o de espacios devuelve todos', () => {
    expect(filterMembers(members, '')).toEqual(members);
    expect(filterMembers(members, '   ')).toEqual(members);
  });

  it('sin coincidencias devuelve una lista vacía', () => {
    expect(filterMembers(members, 'zzz')).toEqual([]);
  });
});
