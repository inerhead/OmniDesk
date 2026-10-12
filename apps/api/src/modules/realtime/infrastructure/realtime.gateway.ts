import { Inject, Logger } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayInit } from '@nestjs/websockets';
import { REALTIME_PATH } from '@omnidesk/contracts';
import { ENV, type Env } from '../../../shared/config/env';
import { DEMO_TENANT } from '../../demo/application/demo.constants';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from '../../tenancy/application/ports/tenant.repository';
import type { SocketIoServer, SocketIoSocket } from './socket-io.types';
import { SocketIoRealtimePublisher, tenantRoom } from './socket-io-realtime-publisher';

/** CORS y el resto de opciones del server se configuran en `RealtimeIoAdapter`. */
@WebSocketGateway({ path: REALTIME_PATH, serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly publisher: SocketIoRealtimePublisher,
  ) {}

  afterInit(server: SocketIoServer): void {
    this.publisher.attach(server);
  }

  async handleConnection(client: SocketIoSocket): Promise<void> {
    // Sin login, solo el modo demo resuelve un tenant. El spec de identidad lo reemplaza por la sesión.
    if (!this.env.DEMO_MODE) return this.reject(client, 'Autenticación requerida');

    try {
      const tenant = await this.tenants.findBySlug(DEMO_TENANT.slug);
      if (!tenant) return this.reject(client, 'El tenant demo todavía no está inicializado');
      await client.join(tenantRoom(tenant.id));
    } catch (error) {
      this.logger.error(`No se pudo unir el socket ${client.id}: ${String(error)}`);
      this.reject(client, 'No se pudo establecer la conexión');
    }
  }

  private reject(client: SocketIoSocket, message: string): void {
    client.emit('error', message);
    client.disconnect(true);
  }
}
