import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnectionStatus, setConnectionStatus } from './connection-status';
import { bindSocket, type SocketLike } from './realtime-client';

class FakeSocket implements SocketLike {
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  connect = vi.fn();

  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      listener as (...args: unknown[]) => void,
    ]);
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

const validEvent = {
  type: 'conversation.changed',
  conversationId: '0199c0de-0000-7000-8000-000000000001',
  reason: 'message',
  occurredAt: '2026-10-12T10:00:00.000Z',
};

describe('bindSocket', () => {
  let socket: FakeSocket;
  const handlers = { onEvent: vi.fn(), onResync: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new FakeSocket();
    handlers.onEvent.mockClear();
    handlers.onResync.mockClear();
    setConnectionStatus('connecting');
    bindSocket(socket, handlers);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pasa a live y pide un resync al conectar', () => {
    socket.emit('connect');

    expect(getConnectionStatus()).toBe('live');
    expect(handlers.onResync).toHaveBeenCalledTimes(1);
  });

  it('pasa a reconnecting al desconectarse y vuelve a live con otro resync al reconectar', () => {
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');
    expect(getConnectionStatus()).toBe('reconnecting');

    socket.emit('connect');

    expect(getConnectionStatus()).toBe('live');
    expect(handlers.onResync).toHaveBeenCalledTimes(2);
  });

  it('sigue en connecting si nunca se conectó y el servidor no responde', () => {
    socket.emit('connect_error', new Error('xhr poll error'));

    expect(getConnectionStatus()).toBe('connecting');
  });

  it('pasa a reconnecting si falla un reintento tras haber estado conectado', () => {
    socket.emit('connect');
    socket.emit('connect_error', new Error('xhr poll error'));

    expect(getConnectionStatus()).toBe('reconnecting');
  });

  it('reintenta la conexión 5 s después de que el servidor la cierre', () => {
    socket.emit('connect');
    socket.emit('disconnect', 'io server disconnect');

    expect(socket.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('no reintenta a mano ante otras desconexiones (lo hace socket.io)', () => {
    socket.emit('disconnect', 'transport close');
    vi.advanceTimersByTime(60_000);

    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('entrega los eventos válidos', () => {
    socket.emit('conversation.changed', validEvent);

    expect(handlers.onEvent).toHaveBeenCalledWith(validEvent);
  });

  it('ignora los eventos inválidos', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    socket.emit('conversation.changed', { ...validEvent, conversationId: 'no-uuid' });

    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
