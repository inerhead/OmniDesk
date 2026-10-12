export const AVATAR_COLORS = [
  'indigo',
  'violet',
  'sky',
  'teal',
  'emerald',
  'amber',
  'rose',
  'orange',
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * Iniciales del avatar: primera letra de las dos primeras palabras ("Juan Pérez" → "JP"), o las dos
 * primeras letras si hay una sola palabra. Sin nombre se usa `fallback`; sin letras (un teléfono), "#".
 */
export function initials(displayName: string | null, fallback: string): string {
  const name = displayName?.trim() || fallback;
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  if (words.length >= 2) {
    const first = (word: string) => word.match(/\p{L}/u)![0];
    return `${first(words[0]!)}${first(words[1]!)}`.toUpperCase();
  }
  const letters = name.match(/\p{L}/gu) ?? [];
  return letters.slice(0, 2).join('').toUpperCase() || '#';
}

/** Color estable derivado del id (FNV-1a): el mismo contacto siempre tiene el mismo color. */
export function avatarColor(id: string): AvatarColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length]!;
}
