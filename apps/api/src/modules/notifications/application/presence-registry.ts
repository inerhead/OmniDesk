import { Injectable } from '@nestjs/common';
import type { PresenceEntry, PresenceMap } from '../domain/notification';

/** Presencia en memoria: una sola instancia del API (SPEC 08). Se borra al desconectar el socket. */
@Injectable()
export class PresenceRegistry {
  private readonly sockets = new Map<string, PresenceEntry>();

  set(socketId: string, entry: PresenceEntry): void {
    this.sockets.set(socketId, entry);
  }

  remove(socketId: string): void {
    this.sockets.delete(socketId);
  }

  snapshot(): PresenceMap {
    return this.sockets;
  }
}
