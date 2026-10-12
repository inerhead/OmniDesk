import type { ConversationPosition } from './ports/conversation-read-model';

export class InvalidCursorError extends Error {
  constructor() {
    super('Cursor inválido');
    this.name = 'InvalidCursorError';
  }
}

/** Cursor opaco: base64url de "<lastMessageAt ISO>|<id>". */
export function encodeConversationCursor(position: ConversationPosition): string {
  return Buffer.from(`${position.lastMessageAt.toISOString()}|${position.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeConversationCursor(cursor: string): ConversationPosition {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const lastMessageAt = new Date(iso ?? '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !uuid.test(id) || Number.isNaN(lastMessageAt.getTime()))
    throw new InvalidCursorError();
  return { lastMessageAt, id };
}
