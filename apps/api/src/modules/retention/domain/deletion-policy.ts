export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

/** Borrar un contacto y su historial es irreversible: solo OWNER (SPEC 12). */
export function canDeleteContact(role: MemberRole): boolean {
  return role === 'OWNER';
}
