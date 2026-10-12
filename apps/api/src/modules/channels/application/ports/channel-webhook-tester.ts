export interface ChannelTestResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
}

/** Envía un `ping` firmado al webhook del canal, sin reintentos. */
export interface ChannelWebhookTester {
  ping(input: {
    channelId: string;
    webhookUrl: string;
    secret: string;
    now: Date;
  }): Promise<ChannelTestResult>;
}

export const CHANNEL_WEBHOOK_TESTER = Symbol('CHANNEL_WEBHOOK_TESTER');
