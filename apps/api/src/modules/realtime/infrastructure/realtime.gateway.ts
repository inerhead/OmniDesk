import { Logger } from '@nestjs/common';
import {
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { PresenceEventSchema, REALTIME_PATH } from '@omnidesk/contracts';
import { ResolveActorUseCase } from '../../identity/application/resolve-actor.use-case';
import { ResolveSessionUseCase } from '../../identity/application/resolve-session.use-case';
import { readSessionToken } from '../../identity/infrastructure/http/session-cookie';
import { PresenceRegistry } from '../../notifications/application/presence-registry';
import type { SocketIoServer, SocketIoSocket } from './socket-io.types';
import { SocketIoRealtimePublisher, tenantRoom } from './socket-io-realtime-publisher';

type PresenceSocket = SocketIoSocket & { id: string; data: { memberId?: string } };

/**
 * El handshake reutiliza la cookie de sesión de la web: sin sesión válida o sin empresa activa, la
 * conexión se rechaza. El socket se une al room de la empresa activa; al cambiarla, la web reconecta.
 * CORS y el resto de opciones del server se configuran en `RealtimeIoAdapter`.
 */
@WebSocketGateway({ path: REALTIME_PATH, serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly resolveSession: ResolveSessionUseCase,
    private readonly resolveActor: ResolveActorUseCase,
    private readonly publisher: SocketIoRealtimePublisher,
    private readonly presence: PresenceRegistry,
  ) {}

  afterInit(server: SocketIoServer): void {
    this.publisher.attach(server);
  }

  async handleConnection(client: SocketIoSocket): Promise<void> {
    try {
      const resolved = await this.resolveSession.execute(
        readSessionToken(client.handshake.headers.cookie),
      );
      if (!resolved) return this.reject(client, 'Autenticación requerida');

      const resolution = await this.resolveActor.execute(resolved.session);
      if (resolution.kind === 'no-active-tenant') return this.reject(client, 'Sin empresa activa');
      // Empresa inactiva (SPEC 16): solo sus OWNER siguen en la sala, para ver la reactivación.
      if (resolution.kind === 'inactive' && resolution.actor.role !== 'OWNER') {
        return this.reject(client, 'Empresa inactiva');
      }
      (client as PresenceSocket).data.memberId = resolution.actor.memberId;
      await client.join(tenantRoom(resolution.actor.tenantId));
    } catch (error) {
      this.logger.error(`No se pudo unir el socket ${client.id}: ${String(error)}`);
      this.reject(client, 'No se pudo establecer la conexión');
    }
  }

  handleDisconnect(client: SocketIoSocket): void {
    this.presence.remove((client as PresenceSocket).id);
  }

  @SubscribeMessage('presence')
  onPresence(client: SocketIoSocket, payload: unknown): void {
    const socket = client as PresenceSocket;
    const parsed = PresenceEventSchema.safeParse(payload);
    if (!parsed.success || !socket.data.memberId) return;
    this.presence.set(socket.id, { memberId: socket.data.memberId, ...parsed.data });
  }

  private reject(client: SocketIoSocket, message: string): void {
    client.emit('error', message);
    client.disconnect(true);
  }
}
