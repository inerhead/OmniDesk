/** Minúsculas y sin tildes: "José" y "jose" coinciden. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Miembros cuyo nombre o email contienen `query` (sin distinguir mayúsculas ni tildes). */
export function filterMembers<T extends { displayName: string; email: string }>(
  members: T[],
  query: string,
): T[] {
  const needle = normalize(query.trim());
  if (!needle) return members;
  return members.filter(
    (member) =>
      normalize(member.displayName).includes(needle) || normalize(member.email).includes(needle),
  );
}
