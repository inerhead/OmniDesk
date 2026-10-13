import { describe, expect, it } from 'vitest';
import { formatInboxCount, parseInbox, visibleInboxes } from './inbox';

describe('visibleInboxes', () => {
  it('OWNER y ADMIN ven las 4 pestañas', () => {
    expect(visibleInboxes('OWNER')).toEqual(['ai', 'mine', 'all', 'closed']);
    expect(visibleInboxes('ADMIN')).toEqual(['ai', 'mine', 'all', 'closed']);
  });

  it('un AGENT ve 3 pestañas, sin "Todas"', () => {
    expect(visibleInboxes('AGENT')).toEqual(['ai', 'mine', 'closed']);
  });
});

describe('parseInbox', () => {
  it('acepta una bandeja válida del rol', () => {
    expect(parseInbox('mine', 'AGENT')).toBe('mine');
    expect(parseInbox('all', 'OWNER')).toBe('all');
  });

  it('cae a la IA si falta, es inválida o el rol no puede verla', () => {
    expect(parseInbox(null, 'OWNER')).toBe('ai');
    expect(parseInbox('otra', 'OWNER')).toBe('ai');
    expect(parseInbox('all', 'AGENT')).toBe('ai');
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
