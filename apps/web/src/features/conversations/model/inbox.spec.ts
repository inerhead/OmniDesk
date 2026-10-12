import { describe, expect, it } from 'vitest';
import { parseInbox, visibleInboxes } from './inbox';

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
