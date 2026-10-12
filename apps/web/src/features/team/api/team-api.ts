import {
  CreateInvitationResponseSchema,
  InvitationPreviewSchema,
  ListInvitationsResponseSchema,
  MemberSchema,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type InvitationPreview,
  type ListInvitationsResponse,
  type Member,
  type MemberRole,
} from '@omnidesk/contracts';
import { apiCodeError } from '@/shared/api/api-error';
import { deleteJson, getJson, patchJson, postJson } from '@/shared/api/http-client';

const tokenPath = (token: string) => `/api/v1/invitations/by-token/${encodeURIComponent(token)}`;

export async function fetchInvitations(): Promise<ListInvitationsResponse> {
  const { status, body } = await getJson('/api/v1/invitations');
  if (status !== 200) throw apiCodeError(status, body);
  return ListInvitationsResponseSchema.parse(body);
}

/** Lanza `ApiCodeError` (403 por rol, 409 `ALREADY_MEMBER`). */
export async function postInvitation(
  input: CreateInvitationRequest,
): Promise<CreateInvitationResponse> {
  const { status, body } = await postJson('/api/v1/invitations', input);
  if (status !== 201) throw apiCodeError(status, body);
  return CreateInvitationResponseSchema.parse(body);
}

export async function deleteInvitation(id: string): Promise<void> {
  const { status, body } = await deleteJson(`/api/v1/invitations/${encodeURIComponent(id)}`);
  if (status !== 204) throw apiCodeError(status, body);
}

/** Vista previa pública del enlace. Lanza `ApiCodeError(404)` si no existe. */
export async function fetchInvitationPreview(token: string): Promise<InvitationPreview> {
  const { status, body } = await getJson(tokenPath(token), { allowUnauthorized: true });
  if (status !== 200) throw apiCodeError(status, body);
  return InvitationPreviewSchema.parse(body);
}

/** Lanza `ApiCodeError` (410 `INVITATION_EXPIRED`, 409 `INVITATION_EMAIL_MISMATCH` o `ALREADY_MEMBER`). */
export async function postAcceptInvitation(token: string): Promise<void> {
  const { status, body } = await postJson(`${tokenPath(token)}/accept`, undefined);
  if (status !== 204) throw apiCodeError(status, body);
}

/** Lanza `ApiCodeError` (409 `LAST_OWNER`). */
export async function patchMemberRole(id: string, role: MemberRole): Promise<Member> {
  const { status, body } = await patchJson(`/api/v1/members/${encodeURIComponent(id)}`, { role });
  if (status !== 200) throw apiCodeError(status, body);
  return MemberSchema.parse(body);
}

/** Lanza `ApiCodeError` (409 `LAST_OWNER`). */
export async function deleteMember(id: string): Promise<void> {
  const { status, body } = await deleteJson(`/api/v1/members/${encodeURIComponent(id)}`);
  if (status !== 204) throw apiCodeError(status, body);
}
