import type { Prisma } from '../../../generated/prisma/client';
import { resolveAvatarUrl } from '../domain/user';

/** Columnas de `users` de las que sale la foto. */
export const avatarSourceSelect = {
  id: true,
  googleAvatarUrl: true,
  avatarKey: true,
  avatarUpdatedAt: true,
} satisfies Prisma.UserSelect;

/** Miembro con la foto de su usuario: para remitentes, asignados, actores y listas. */
export const memberRefSelect = {
  id: true,
  displayName: true,
  user: { select: avatarSourceSelect },
} satisfies Prisma.TenantMemberSelect;

export type MemberRefRow = Prisma.TenantMemberGetPayload<{ select: typeof memberRefSelect }>;

export interface MemberRefWithAvatar {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Un miembro sin usuario enlazado (filas previas a SPEC 07) no tiene foto. */
export function memberAvatarUrl(row: Pick<MemberRefRow, 'user'>): string | null {
  return row.user ? resolveAvatarUrl(row.user) : null;
}

export function toMemberRef(row: MemberRefRow): MemberRefWithAvatar {
  return { id: row.id, displayName: row.displayName, avatarUrl: memberAvatarUrl(row) };
}

export function toMemberRefOrNull(row: MemberRefRow | null): MemberRefWithAvatar | null {
  return row && toMemberRef(row);
}
