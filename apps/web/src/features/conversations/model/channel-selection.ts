import type { InboxChannel } from '@omnidesk/contracts';
import { z } from 'zod';
import { initials } from '@/shared/lib/avatar';

const channelIdSchema = z.uuid();

export const CHANNEL_TYPE_LABEL: Record<InboxChannel['type'], string> = { WHATSAPP: 'WhatsApp' };

/** `?channel=` si es un uuid; si no, todos los canales. */
export function parseChannelId(value: string | null): string | undefined {
  const parsed = channelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Conserva bandeja y búsqueda al cambiar de canal. Sin `channelId`, quita el filtro. */
export function conversationListSearch(
  current: URLSearchParams,
  channelId: string | undefined,
): string {
  const params = new URLSearchParams();
  const inbox = current.get('inbox');
  const q = current.get('q');
  if (inbox) params.set('inbox', inbox);
  if (q) params.set('q', q);
  if (channelId) params.set('channel', channelId);
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Iniciales de un canal en el rail, distintas entre sí: "GO" y "GO" pasan a "GC" y "GN", o a "G1" y "G2". */
export function channelBadges(channels: { id: string; name: string }[]): Map<string, string> {
  const badges = new Map(channels.map(({ id, name }) => [id, initials(name, '?')]));
  for (const { id, name } of repeated(channels, badges)) {
    const words = name
      .trim()
      .split(/\s+/)
      .filter((word) => /\p{L}/u.test(word));
    if (words.length > 2) badges.set(id, `${firstLetter(words[0]!)}${firstLetter(words.at(-1)!)}`);
  }
  const seen = new Map<string, number>();
  for (const { id } of repeated(channels, badges)) {
    const badge = badges.get(id)!;
    const count = (seen.get(badge) ?? 0) + 1;
    seen.set(badge, count);
    badges.set(id, `${badge[0]}${count}`);
  }
  return badges;
}

function repeated<T extends { id: string }>(channels: T[], badges: Map<string, string>): T[] {
  const counts = new Map<string, number>();
  for (const badge of badges.values()) counts.set(badge, (counts.get(badge) ?? 0) + 1);
  return channels.filter(({ id }) => counts.get(badges.get(id)!)! > 1);
}

function firstLetter(word: string): string {
  return word.match(/\p{L}/u)![0].toUpperCase();
}
