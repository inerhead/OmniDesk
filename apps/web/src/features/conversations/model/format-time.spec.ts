import { describe, expect, it } from 'vitest';
import { formatConversationTime, formatMessageTime } from './format-time';

const now = new Date(2026, 9, 12, 18, 30);

describe('formatConversationTime', () => {
  it('muestra la hora si el mensaje es de hoy', () => {
    expect(formatConversationTime(new Date(2026, 9, 12, 9, 5).toISOString(), now)).toBe('09:05');
  });

  it('muestra "Ayer" si el mensaje es de ayer', () => {
    expect(formatConversationTime(new Date(2026, 9, 11, 23, 59).toISOString(), now)).toBe('Ayer');
  });

  it('muestra dd/MM si el mensaje es más antiguo', () => {
    expect(formatConversationTime(new Date(2026, 9, 3, 12, 0).toISOString(), now)).toBe('03/10');
  });
});

describe('formatMessageTime', () => {
  it('muestra la hora en formato 24 h', () => {
    expect(formatMessageTime(new Date(2026, 9, 12, 16, 7).toISOString())).toBe('16:07');
  });
});
