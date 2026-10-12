import {
  DeliveryStatusRequestSchema,
  DeliveryStatusResponseSchema,
  InboundMessageRequestSchema,
  InboundMessageResponseSchema,
  OutboundAiMessageRejectedSchema,
  OutboundAiMessageRequestSchema,
  OutboundAiMessageResponseSchema,
  type DeliveryStatusRequest,
  type DeliveryStatusResponse,
  type InboundMessageRequest,
  type InboundMessageResponse,
  type OutboundAiMessageRequest,
} from '@omnidesk/contracts';
import { createHmac } from 'node:crypto';

export type AiReplyOutcome = { sent: true; messageId: string } | { sent: false; reason: string };

/** Cliente HTTP de los endpoints de integración: se comporta como lo hará n8n. */
export class IntegrationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /** Secreto HMAC del canal: si existe, firma cada petición (`X-OmniDesk-Signature`). */
  private readonly hmacSecret: string | undefined;

  constructor(baseUrl: string, apiKey: string, hmacSecret?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.hmacSecret = hmacSecret || undefined;
  }

  async sendInbound(request: InboundMessageRequest): Promise<InboundMessageResponse> {
    const res = await this.post(
      '/api/v1/integrations/messages/inbound',
      InboundMessageRequestSchema.parse(request),
    );
    if (res.status !== 200 && res.status !== 201) throw await httpError(res);
    return InboundMessageResponseSchema.parse(await res.json());
  }

  /** Registra la respuesta de IA. Con `409` la IA NO debe enviar el mensaje. */
  async sendAiReply(request: OutboundAiMessageRequest): Promise<AiReplyOutcome> {
    const res = await this.post(
      '/api/v1/integrations/messages/outbound',
      OutboundAiMessageRequestSchema.parse(request),
    );
    if (res.status === 409) {
      return {
        sent: false,
        reason: OutboundAiMessageRejectedSchema.parse(await res.json()).reason,
      };
    }
    if (res.status !== 201) throw await httpError(res);
    return {
      sent: true,
      messageId: OutboundAiMessageResponseSchema.parse(await res.json()).messageId,
    };
  }

  /** Reporta el estado de entrega de una respuesta de IA, como lo hará n8n. */
  async reportStatus(request: DeliveryStatusRequest): Promise<DeliveryStatusResponse> {
    const res = await this.post(
      '/api/v1/integrations/messages/status',
      DeliveryStatusRequestSchema.parse(request),
    );
    if (res.status !== 200) throw await httpError(res);
    return DeliveryStatusResponseSchema.parse(await res.json());
  }

  private post(path: string, body: unknown): Promise<Response> {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    if (this.hmacSecret) headers['x-omnidesk-signature'] = signPayload(this.hmacSecret, raw);
    return fetch(`${this.baseUrl}${path}`, { method: 'POST', headers, body: raw });
  }
}

async function httpError(res: Response): Promise<Error> {
  return new Error(`HTTP ${res.status} ${res.url}: ${await res.text()}`);
}

/** `t=<unix_segundos>,v1=<hex(HMAC_SHA256(secreto, t + "." + cuerpo))>` (docs/integracion-n8n.md). */
export function signPayload(
  secret: string,
  rawBody: string,
  nowSec = Math.floor(Date.now() / 1000),
) {
  const v1 = createHmac('sha256', secret).update(`${nowSec}.${rawBody}`).digest('hex');
  return `t=${nowSec},v1=${v1}`;
}
