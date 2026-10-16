import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelSecretCipher } from '../../channels/application/ports/channel-secret-cipher';
import type { ChannelForSend } from '../../channels/application/ports/channel.repository';
import {
  ChannelNotConfiguredError,
  type SendMessageRequest,
} from '../application/ports/messaging-provider.port';
import { N8nMessagingProvider } from './n8n-messaging-provider';

const CLIENT_ID = 'acme-omnidesk';
const SECRET = 'client-secret-n8n-test';
/** "Cifrado" de prueba: el blob es el propio texto. */
const cipher: ChannelSecretCipher = {
  encrypt: (plain) => new Uint8Array(Buffer.from(plain)),
  decrypt: (blob) => Buffer.from(blob).toString('utf8'),
};

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('N8nMessagingProvider', () => {
  let server: Server;
  let url: string;
  let received: Received[];
  let reply: (res: ServerResponse) => void;
  let provider: N8nMessagingProvider;

  const request = (overrides: Partial<ChannelForSend> = {}): SendMessageRequest => ({
    tenantId: 't1',
    channel: {
      id: '0199c0de-0000-7000-8000-0000000000c1',
      provider: 'N8N',
      externalId: '1234567890',
      webhookUrl: url,
      n8nClientId: CLIENT_ID,
      n8nClientSecretEnc: cipher.encrypt(SECRET),
      ...overrides,
    },
    conversationId: '0199c0de-0000-7000-8000-0000000000aa',
    messageId: '0199c0de-0000-7000-8000-000000000001',
    to: '+573001110001',
    text: 'Hola desde OmniDesk',
    attachment: null,
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        reply(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/send`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    reply = (res) =>
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"providerMessageId":"wamid.ABC"}');
    provider = new N8nMessagingProvider(cipher);
  });

  it('2xx con providerMessageId: credenciales de cliente, Idempotency-Key y el cuerpo', async () => {
    await expect(provider.send(request())).resolves.toEqual({ providerMessageId: 'wamid.ABC' });

    expect(received).toHaveLength(1);
    const [{ headers, body }] = received as [Received];
    expect(headers['idempotency-key']).toBe('0199c0de-0000-7000-8000-000000000001');
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-client-id']).toBe(CLIENT_ID);
    expect(headers['x-client-secret']).toBe(SECRET);
    expect(headers['x-omnidesk-signature']).toBeUndefined();
    expect(JSON.parse(body)).toEqual({
      type: 'message.send',
      messageId: '0199c0de-0000-7000-8000-000000000001',
      conversationId: '0199c0de-0000-7000-8000-0000000000aa',
      channel: { id: '0199c0de-0000-7000-8000-0000000000c1', externalId: '1234567890' },
      to: '+573001110001',
      text: 'Hola desde OmniDesk',
    });
  });

  it('5xx lanza un error (el dispatcher reintenta)', async () => {
    reply = (res) => res.writeHead(500).end('boom');
    await expect(provider.send(request())).rejects.toThrow('n8n respondió HTTP 500');
  });

  it('2xx sin providerMessageId lanza un error', async () => {
    reply = (res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    await expect(provider.send(request())).rejects.toThrow('sin providerMessageId');
  });

  it('una redirección no se sigue y cuenta como fallo', async () => {
    reply = (res) => res.writeHead(302, { location: 'https://evil.example/' }).end();
    await expect(provider.send(request())).rejects.toThrow('HTTP 302');
  });

  it('timeout lanza un error', async () => {
    reply = () => undefined; // nunca responde
    provider.timeoutMs = 100;
    await expect(provider.send(request())).rejects.toThrow(
      'n8n no respondió: Tiempo de espera agotado',
    );
  });

  it('webhook caído (conexión rechazada) lanza un error', async () => {
    await expect(
      provider.send(request({ webhookUrl: 'http://127.0.0.1:1/webhook' })),
    ).rejects.toThrow(/n8n no respondió/);
  });

  it('sin credenciales de cliente: CHANNEL_NOT_CONFIGURED y no llama al webhook', async () => {
    await expect(provider.send(request({ n8nClientSecretEnc: null }))).rejects.toBeInstanceOf(
      ChannelNotConfiguredError,
    );
    await expect(provider.send(request({ n8nClientId: null }))).rejects.toBeInstanceOf(
      ChannelNotConfiguredError,
    );
    await expect(provider.send(request({ webhookUrl: null }))).rejects.toThrow(
      'CHANNEL_NOT_CONFIGURED',
    );
    expect(received).toHaveLength(0);
  });

  it('rechaza adjuntos como canal no configurado', async () => {
    await expect(
      provider.send({
        ...request(),
        attachment: { kind: 'IMAGE', mimeType: 'image/png', fileName: null, storageKey: 'k' },
      }),
    ).rejects.toBeInstanceOf(ChannelNotConfiguredError);
  });
});
