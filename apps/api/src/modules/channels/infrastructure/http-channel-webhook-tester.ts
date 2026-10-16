import { Injectable } from '@nestjs/common';
import type { N8nPingRequest } from '@omnidesk/contracts';
import { describeFetchError, postJson } from '../../../shared/infrastructure/http/signed-webhook';
import { n8nClientHeaders } from '../domain/channel';
import type {
  ChannelTestResult,
  ChannelWebhookTester,
} from '../application/ports/channel-webhook-tester';

export const CHANNEL_TEST_TIMEOUT_MS = 10_000;

@Injectable()
export class HttpChannelWebhookTester implements ChannelWebhookTester {
  async ping({
    channelId,
    webhookUrl,
    clientSecret,
    now,
  }: {
    channelId: string;
    webhookUrl: string;
    clientSecret: string;
    now: Date;
  }): Promise<ChannelTestResult> {
    const body: N8nPingRequest = { type: 'ping', channelId, at: now.toISOString() };
    const started = performance.now();
    try {
      const res = await postJson(webhookUrl, body, {
        timeoutMs: CHANNEL_TEST_TIMEOUT_MS,
        headers: n8nClientHeaders(channelId, clientSecret),
      });
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok,
        httpStatus: res.status,
        latencyMs: res.latencyMs,
        error: ok ? null : `El webhook respondió HTTP ${res.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        httpStatus: null,
        latencyMs: Math.round(performance.now() - started),
        error: describeFetchError(error),
      };
    }
  }
}
