import type { RealtimeEvent } from '@omnidesk/contracts';

/** Puerto: entrega un evento a los clientes conectados de un tenant. */
export interface RealtimePublisher {
  /** Lanza si no puede entregar el evento: el dispatcher lo reintentará. */
  publish(tenantId: string, event: RealtimeEvent): void;
}

export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');
