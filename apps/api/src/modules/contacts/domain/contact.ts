export interface Contact {
  id: string;
  tenantId: string;
  displayName: string | null;
}

/** Identidad del contacto en un canal: su teléfono E.164 en WhatsApp. */
export interface ContactIdentityRef {
  tenantId: string;
  channelId: string;
  externalId: string;
}
