import type { IoAdapter } from '@nestjs/platform-socket.io';

// `socket.io` es una dependencia transitiva de `@nestjs/platform-socket.io` (con pnpm no se puede
// importar directo), así que sus tipos se derivan del adaptador de Nest.
export type SocketIoServer = ReturnType<IoAdapter['create']>;
export type SocketIoSocket = Parameters<IoAdapter['bindMessageHandlers']>[0];
