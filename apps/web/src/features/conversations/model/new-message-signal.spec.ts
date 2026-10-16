import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSignal,
  getNewMessageSignal,
  isConversationsPath,
  signalInbound,
} from './new-message-signal';

describe('new-message-signal', () => {
  beforeEach(() => clearSignal());

  it('empieza en reposo', () => {
    expect(getNewMessageSignal()).toEqual({ kind: 'idle' });
  });

  it('fuera de /conversations pasa a pending y se queda ahí con más mensajes', () => {
    signalInbound(false);
    expect(getNewMessageSignal()).toEqual({ kind: 'pending' });

    const before = getNewMessageSignal();
    signalInbound(false);
    expect(getNewMessageSignal()).toBe(before);
  });

  it('dentro de /conversations hace una pasada y cada mensaje sube seq', () => {
    signalInbound(true);
    const first = getNewMessageSignal();
    expect(first.kind).toBe('pulse');

    signalInbound(true);
    const second = getNewMessageSignal();
    expect(second.kind).toBe('pulse');
    if (first.kind === 'pulse' && second.kind === 'pulse') {
      expect(second.seq).toBeGreaterThan(first.seq);
    }
  });

  it('clearSignal vuelve a reposo desde pending y desde pulse', () => {
    signalInbound(false);
    clearSignal();
    expect(getNewMessageSignal()).toEqual({ kind: 'idle' });

    signalInbound(true);
    clearSignal();
    expect(getNewMessageSignal()).toEqual({ kind: 'idle' });
  });
});

describe('isConversationsPath', () => {
  it('reconoce /conversations y sus rutas hijas', () => {
    expect(isConversationsPath('/conversations')).toBe(true);
    expect(isConversationsPath('/conversations/abc')).toBe(true);
  });

  it('no confunde otras rutas', () => {
    expect(isConversationsPath('/status')).toBe(false);
    expect(isConversationsPath('/settings/company')).toBe(false);
    expect(isConversationsPath('/conversationsx')).toBe(false);
  });
});
