import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_POLLING_INTERVAL_MS,
  backupPollingInterval,
  getConnectionStatus,
  setConnectionStatus,
  subscribeConnectionStatus,
} from './connection-status';

afterEach(() => setConnectionStatus('connecting'));

describe('connection-status', () => {
  it('empieza en connecting', () => {
    expect(getConnectionStatus()).toBe('connecting');
  });

  it('notifica a los suscriptores solo cuando el estado cambia', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConnectionStatus(listener);

    setConnectionStatus('live');
    setConnectionStatus('live');
    setConnectionStatus('reconnecting');

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setConnectionStatus('live');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('backupPollingInterval', () => {
  it('no hace polling con el socket conectado', () => {
    expect(backupPollingInterval('live')).toBe(false);
  });

  it.each(['connecting', 'reconnecting'] as const)('hace polling cada 15 s en %s', (status) => {
    expect(backupPollingInterval(status)).toBe(BACKUP_POLLING_INTERVAL_MS);
    expect(BACKUP_POLLING_INTERVAL_MS).toBe(15_000);
  });
});
