import { describe, expect, it } from 'vitest';
import { fromRetentionChoice, retentionPreviewNotice, toRetentionChoice } from './retention';

describe('opciones de retención', () => {
  it('ida y vuelta entre los días y la opción del selector', () => {
    expect(toRetentionChoice(null)).toBe('none');
    expect(toRetentionChoice(180)).toBe('180');
    expect(fromRetentionChoice('none')).toBeNull();
    expect(fromRetentionChoice('365')).toBe(365);
  });
});

describe('retentionPreviewNotice', () => {
  it('cuenta en singular, plural y cero', () => {
    expect(retentionPreviewNotice(3)).toBe(
      'Se borrarán 3 conversaciones en la próxima ejecución (03:30).',
    );
    expect(retentionPreviewNotice(1)).toBe(
      'Se borrará 1 conversación en la próxima ejecución (03:30).',
    );
    expect(retentionPreviewNotice(0)).toBe(
      'No se borrará ninguna conversación en la próxima ejecución (03:30).',
    );
  });
});
