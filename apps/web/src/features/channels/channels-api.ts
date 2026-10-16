import {
  ChannelSchema,
  ListChannelsResponseSchema,
  ChannelTestResponseSchema,
  N8nClientCredentialsResponseSchema,
  type CreateChannelRequest,
  type UpdateChannelRequest,
  type ConfigureWhatsAppRequest,
} from '@omnidesk/contracts';
import {
  deleteJson,
  getJson,
  patchJson,
  postJson,
  type ApiResponse,
} from '@/shared/api/http-client';

function checked(response: ApiResponse): unknown {
  if (response.status >= 400) {
    const body = response.body as { message?: unknown } | null;
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : `No se pudo completar la acción (HTTP ${response.status}).`,
    );
  }
  return response.body;
}
export async function fetchChannels() {
  return ListChannelsResponseSchema.parse(checked(await getJson('/api/v1/channels')));
}
export async function createChannel(body: CreateChannelRequest) {
  return ChannelSchema.parse(checked(await postJson('/api/v1/channels', body)));
}
export async function updateChannel(id: string, body: UpdateChannelRequest) {
  return ChannelSchema.parse(checked(await patchJson(`/api/v1/channels/${id}`, body)));
}
export async function configureWhatsApp(id: string, body: ConfigureWhatsAppRequest) {
  checked(await patchJson(`/api/v1/channels/${id}/whatsapp`, body));
}
export async function generateN8nClientSecret(id: string) {
  return N8nClientCredentialsResponseSchema.parse(
    checked(await postJson(`/api/v1/channels/${id}/n8n-client`, {})),
  );
}
export async function removeN8nClient(id: string) {
  return ChannelSchema.parse(checked(await deleteJson(`/api/v1/channels/${id}/n8n-client`)));
}
export async function testChannel(id: string) {
  return ChannelTestResponseSchema.parse(
    checked(await postJson(`/api/v1/channels/${id}/test`, {}, { timeoutMs: 15_000 })),
  );
}
