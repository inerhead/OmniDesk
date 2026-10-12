import type { Member } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { resolveActor } from './resolve-actor';

const member = (id: string, role: Member['role'], displayName = id): Member => ({
  id,
  role,
  displayName,
});
const members = [
  member('sup', 'OWNER', 'Sup. Demo'),
  member('laura', 'AGENT'),
  member('mateo', 'AGENT'),
];

describe('resolveActor', () => {
  it('devuelve el miembro elegido si existe', () => {
    expect(resolveActor(members, 'laura')?.id).toBe('laura');
  });

  it('usa al supervisor por defecto cuando no hay elección', () => {
    expect(resolveActor(members, null)?.id).toBe('sup');
  });

  it('vuelve al supervisor si el miembro guardado ya no existe', () => {
    expect(resolveActor(members, 'borrado')?.id).toBe('sup');
  });

  it('sin OWNER usa el primer miembro, y sin miembros devuelve null', () => {
    expect(resolveActor(members.slice(1), null)?.id).toBe('laura');
    expect(resolveActor([], 'laura')).toBeNull();
  });
});
