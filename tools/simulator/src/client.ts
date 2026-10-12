import {
  InboundMessageRequestSchema,
  InboundMessageResponseSchema,
  OutboundAiMessageRejectedSchema,
  OutboundAiMessageRequestSchema,
  OutboundAiMessageResponseSchema,
  type InboundMessageRequest,
  type InboundMessageResponse,
  type OutboundAiMessageRequest,
} from '@omnidesk/contracts';

export type AiReplyOutcome = { sent: true; messageId: string } | { sent: false; reason: string };

/** Cliente HTTP de los endpoints de integración: se comporta como lo hará n8n. */
export class IntegrationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
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

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
  }
}

async function httpError(res: Response): Promise<Error> {
  return new Error(`HTTP ${res.status} ${res.url}: ${await res.text()}`);
}
