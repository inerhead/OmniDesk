import { Injectable } from '@nestjs/common';
import {
  CONVERSATION_CHANGED_EVENT,
  TENANT_STATUS_CHANGED_EVENT,
  type RealtimeEvent,
  type TenantStatusChangedEvent,
} from '@omnidesk/contracts';
import type { RealtimePublisher } from '../application/ports/realtime-publisher';
import type { SocketIoServer } from './socket-io.types';

export const tenantRoom = (tenantId: string) => `tenant:${tenantId}`;

/** Publica en el room del tenant del server de Socket.IO. El gateway le entrega el server al iniciar. */
@Injectable()
export class SocketIoRealtimePublisher implements RealtimePublisher {
  private server?: SocketIoServer;

  attach(server: SocketIoServer): void {
    this.server = server;
  }

  publish(tenantId: string, event: RealtimeEvent): void {
    if (!this.server) throw new Error('El servidor de Socket.IO todavía no está listo');
    this.server.to(tenantRoom(tenantId)).emit(CONVERSATION_CHANGED_EVENT, event);
  }

  publishTenantStatus(tenantId: string, event: TenantStatusChangedEvent): void {
    if (!this.server) throw new Error('El servidor de Socket.IO todavía no está listo');
    this.server.to(tenantRoom(tenantId)).emit(TENANT_STATUS_CHANGED_EVENT, event);
  }
}
