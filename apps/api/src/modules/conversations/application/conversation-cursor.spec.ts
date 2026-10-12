import { describe, expect, it } from 'vitest';
import {
  decodeConversationCursor,
  encodeConversationCursor,
  InvalidCursorError,
} from './conversation-cursor';

describe('cursor de conversaciones', () => {
  it('codifica y decodifica la posición', () => {
    const position = {
      lastMessageAt: new Date('2026-10-12T10:00:00.000Z'),
      id: '0199d8a0-0000-7000-8000-000000000001',
    };

    expect(decodeConversationCursor(encodeConversationCursor(position))).toEqual(position);
  });

  it('rechaza cursores mal formados', () => {
    expect(() => decodeConversationCursor('basura')).toThrowError(InvalidCursorError);
    expect(() =>
      decodeConversationCursor(Buffer.from('no-fecha|x').toString('base64url')),
    ).toThrowError(InvalidCursorError);
  });
});
