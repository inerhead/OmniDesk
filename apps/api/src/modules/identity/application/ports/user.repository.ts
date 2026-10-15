import type { GoogleIdentity, User } from '../../domain/user';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /**
   * Crea el usuario en su primer login con Google o actualiza nombre y avatar. Un usuario ya existente
   * con el mismo email y sin `googleSub` queda enlazado a esa cuenta de Google.
   */
  upsertFromGoogle(identity: GoogleIdentity): Promise<User>;
  /** Ids de los usuarios con esos emails (los admins de plataforma, SPEC 18). */
  findIdsByEmails(emails: string[]): Promise<string[]>;
  /** Usuario demo (sin `googleSub`), por email. */
  upsertDemo(data: { email: string; displayName: string }): Promise<User>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
