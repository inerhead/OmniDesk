import { describe, expect, it } from 'vitest';
import { formatListTime, formatMessageTime } from './format-time';

const now = new Date(2026, 9, 12, 18, 30);

describe('formatListTime', () => {
  it('muestra la hora si el mensaje es de hoy', () => {
    expect(formatListTime(new Date(2026, 9, 12, 9, 5).toISOString(), now)).toBe('09:05');
  });

  it('muestra "Ayer" si el mensaje es de ayer', () => {
    expect(formatListTime(new Date(2026, 9, 11, 23, 59).toISOString(), now)).toBe('Ayer');
  });

  it('muestra el día de la semana abreviado dentro de la última semana', () => {
    // 12/10/2026 es lunes.
    expect(formatListTime(new Date(2026, 9, 10, 8, 0).toISOString(), now)).toBe('sáb');
    expect(formatListTime(new Date(2026, 9, 6, 8, 0).toISOString(), now)).toBe('mar');
  });

  it('muestra dd/MM si el mensaje tiene una semana o más', () => {
    expect(formatListTime(new Date(2026, 9, 5, 12, 0).toISOString(), now)).toBe('05/10');
    expect(formatListTime(new Date(2026, 9, 3, 12, 0).toISOString(), now)).toBe('03/10');
  });
});

describe('formatMessageTime', () => {
  it('muestra la hora en formato 24 h', () => {
    expect(formatMessageTime(new Date(2026, 9, 12, 16, 7).toISOString())).toBe('16:07');
  });
});
