import type { Contact, ContactIdentityRef } from '../../domain/contact';

export interface ContactRepository {
  /**
   * Devuelve el contacto de esa identidad o lo crea.
   * Actualiza `displayName` si llega uno nuevo.
   * Lanza `UniqueConflictError` si otra transacción creó la identidad a la vez.
   */
  findOrCreateByIdentity(identity: ContactIdentityRef, displayName?: string): Promise<Contact>;
}

export const CONTACT_REPOSITORY = Symbol('CONTACT_REPOSITORY');
