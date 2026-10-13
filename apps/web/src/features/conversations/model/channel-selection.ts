import { z } from 'zod';

const channelIdSchema = z.uuid();

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

export function channelInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}
