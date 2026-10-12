import type { Member } from '@omnidesk/contracts';

/**
 * El miembro con el que se actúa: el elegido si sigue existiendo y, si no, "Sup. Demo" (el primer
 * OWNER) o, en último caso, el primero de la lista.
 */
export function resolveActor(members: readonly Member[], storedId: string | null): Member | null {
  return (
    members.find((member) => member.id === storedId) ??
    members.find((member) => member.role === 'OWNER') ??
    members[0] ??
    null
  );
}
