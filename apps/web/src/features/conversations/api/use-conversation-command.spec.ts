import { describe, expect, it } from 'vitest';
import { ConversationCommandError } from './conversations-api';
import { CONFLICT_NOTICE, noticeFor } from './use-conversation-command';

describe('noticeFor', () => {
  it('un 409 (CONTROL_CHANGED o INVALID_STATE) avisa que la conversación cambió', () => {
    expect(noticeFor(new ConversationCommandError(409, 'CONTROL_CHANGED'))).toBe(CONFLICT_NOTICE);
    expect(noticeFor(new ConversationCommandError(409, 'INVALID_STATE'))).toBe(CONFLICT_NOTICE);
    expect(CONFLICT_NOTICE).toBe('La conversación cambió. Se actualizó con el estado actual');
  });

  it('distingue 403 y 404', () => {
    expect(noticeFor(new ConversationCommandError(403))).toBe('Tu rol no permite esta acción');
    expect(noticeFor(new ConversationCommandError(404))).toContain('ya no está disponible');
  });

  it('cualquier otro error es un aviso genérico', () => {
    expect(noticeFor(new Error('red'))).toContain('No se pudo completar');
    expect(noticeFor(new ConversationCommandError(500))).toContain('No se pudo completar');
  });
});
