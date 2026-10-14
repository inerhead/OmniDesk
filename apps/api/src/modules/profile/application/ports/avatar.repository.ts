export interface AvatarOwner {
  /** Clave de la foto subida; `null` si no hay. */
  avatarKey: string | null;
  /** `null` = usuario demo (sin cuenta de Google). */
  googleSub: string | null;
}

export interface AvatarRepository {
  findOwner(userId: string): Promise<AvatarOwner | null>;
  /**
   * Cambia (o, con `null`, quita) la foto subida y devuelve la clave anterior para borrarla. La fila
   * se bloquea: dos subidas a la vez no pierden la clave vieja.
   */
  replace(
    userId: string,
    next: { key: string; at: Date } | null,
  ): Promise<{ previousKey: string | null }>;
  /**
   * `viewer` es miembro activo de `tenantId` y `target` lo es o lo fue (bajas incluidas: su foto
   * sigue en el historial).
   */
  sharesTenant(viewerUserId: string, targetUserId: string, tenantId: string): Promise<boolean>;
}

export const AVATAR_REPOSITORY = Symbol('AVATAR_REPOSITORY');
