import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { IntegrationClient } from './client.ts';
import {
  buildScenarios,
  LIVE_AI_MESSAGES,
  LIVE_CUSTOMER_MESSAGES,
  type Scenario,
} from './scenarios.ts';

const LIVE_INTERVAL_MS = 4_000;
const LIVE_AI_DELAY_MS = 1_500;
/** Tiempo entre `SENT` y `DELIVERED` de una respuesta de IA. */
const DELIVERED_AFTER_MS = 1_000;

/** Reportes `DELIVERED` en curso: el modo fijo espera a que terminen antes de salir. */
const pendingReports = new Set<Promise<void>>();

/** Como lo hará n8n: `SENT` al enviar la respuesta y, 1 s después, `DELIVERED`. */
async function reportDelivery(client: IntegrationClient, messageId: string): Promise<void> {
  const report = (status: 'SENT' | 'DELIVERED') =>
    client.reportStatus({
      messageId,
      providerMessageId: `sim-ai-${messageId}`,
      status,
      occurredAt: new Date().toISOString(),
    });

  await report('SENT');
  const delivered = sleep(DELIVERED_AFTER_MS)
    .then(() => report('DELIVERED'))
    .then(() => undefined)
    .catch((error: unknown) => console.warn(`  DELIVERED no reportado: ${String(error)}`))
    .finally(() => pendingReports.delete(delivered));
  pendingReports.add(delivered);
}

function config(): { apiUrl: string; apiKey: string } {
  const apiKey = process.env.DEMO_CHANNEL_API_KEY;
  if (!apiKey) {
    console.error('Falta DEMO_CHANNEL_API_KEY (defínela en .env).');
    process.exit(1);
  }
  const apiUrl =
    process.env.SIMULATOR_API_URL ??
    `http://localhost:${process.env.GATEWAY_HOST_PORT ?? '8080'}/omnidesk`;
  return { apiUrl, apiKey };
}

/** Un turno: el cliente escribe y la IA registra su respuesta con el controlVersion recibido. */
async function playTurn(
  client: IntegrationClient,
  scenario: Pick<Scenario, 'name' | 'phone'>,
  turn: { id: string; customer: string; ai: string },
  aiDelayMs = 0,
): Promise<{ duplicate: boolean; aiSent: boolean }> {
  const inbound = await client.sendInbound({
    externalMessageId: turn.id,
    from: { externalId: scenario.phone, displayName: scenario.name },
    text: turn.customer,
    sentAt: new Date().toISOString(),
  });
  if (!inbound.aiAllowed) return { duplicate: inbound.duplicate, aiSent: false };

  if (aiDelayMs > 0) await sleep(aiDelayMs);
  const reply = await client.sendAiReply({
    conversationId: inbound.conversationId,
    controlVersion: inbound.controlVersion,
    idempotencyKey: turn.id,
    text: turn.ai,
  });
  if (reply.sent) await reportDelivery(client, reply.messageId);
  else console.warn(`  IA rechazada en ${scenario.name}: ${reply.reason}`);
  return { duplicate: inbound.duplicate, aiSent: reply.sent };
}

async function runFixedScenario(client: IntegrationClient): Promise<void> {
  let customer = 0;
  let duplicates = 0;
  let ai = 0;
  for (const scenario of buildScenarios()) {
    for (const turn of scenario.turns) {
      const result = await playTurn(client, scenario, turn);
      customer += 1;
      if (result.duplicate) duplicates += 1;
      if (result.aiSent) ai += 1;
    }
    console.log(`✓ ${scenario.name} (${scenario.phone}): ${scenario.turns.length} turnos`);
  }
  await Promise.all(pendingReports);
  console.log(
    `\n5 conversaciones · ${customer} mensajes del cliente (${duplicates} ya existían) · ${ai} respuestas de IA registradas`,
  );
}

async function runLive(client: IntegrationClient): Promise<void> {
  const scenarios = buildScenarios();
  let running = true;
  process.on('SIGINT', () => {
    running = false;
    console.log('\nDetenido.');
  });

  console.log(`Modo live: un mensaje cada ${LIVE_INTERVAL_MS / 1000} s. Ctrl+C para detener.`);
  while (running) {
    const scenario = scenarios[randomInt(scenarios.length)]!;
    const index = randomInt(LIVE_CUSTOMER_MESSAGES.length);
    const turn = {
      id: `live-${Date.now()}-${randomUUID().slice(0, 8)}`,
      customer: LIVE_CUSTOMER_MESSAGES[index]!,
      ai: LIVE_AI_MESSAGES[index]!,
    };
    await playTurn(client, scenario, turn, LIVE_AI_DELAY_MS);
    console.log(`→ ${scenario.name}: "${turn.customer}"`);
    if (running) await sleep(LIVE_INTERVAL_MS - LIVE_AI_DELAY_MS);
  }
}

async function main(): Promise<void> {
  const { apiUrl, apiKey } = config();
  const client = new IntegrationClient(apiUrl, apiKey, process.env.SIMULATOR_HMAC_SECRET);
  console.log(`Simulador → ${apiUrl}\n`);

  if (process.argv.includes('--live')) await runLive(client);
  else await runFixedScenario(client);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
