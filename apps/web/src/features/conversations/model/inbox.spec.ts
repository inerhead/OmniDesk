import { describe, expect, it } from 'vitest';
import { formatInboxCount, parseInbox, visibleInboxes } from './inbox';

describe('visibleInboxes', () => {
  it.each(['OWNER', 'ADMIN', 'AGENT'] as const)('%s ve las 4 pestañas (SPEC 21)', (role) => {
    expect(visibleInboxes(role)).toEqual(['ai', 'mine', 'all', 'closed']);
  });
});

describe('parseInbox', () => {
  it('acepta una bandeja válida del rol', () => {
    expect(parseInbox('mine', 'AGENT')).toBe('mine');
    expect(parseInbox('all', 'OWNER')).toBe('all');
    expect(parseInbox('all', 'AGENT')).toBe('all');
  });

  it('cae a la IA si falta o es inválida', () => {
    expect(parseInbox(null, 'OWNER')).toBe('ai');
    expect(parseInbox('otra', 'AGENT')).toBe('ai');
  });
});

describe('formatInboxCount', () => {
  it('sin número en 0 o si aún no se sabe', () => {
    expect(formatInboxCount(0)).toBeNull();
    expect(formatInboxCount(undefined)).toBeNull();
  });

  it('el número tal cual hasta 99 y luego "99+"', () => {
    expect(formatInboxCount(1)).toBe('1');
    expect(formatInboxCount(99)).toBe('99');
    expect(formatInboxCount(100)).toBe('99+');
  });
});
