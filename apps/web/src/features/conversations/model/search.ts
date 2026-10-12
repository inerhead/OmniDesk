/** Mínimo de caracteres de `q` que acepta el API (`ListConversationsQuerySchema`). */
export const MIN_SEARCH_LENGTH = 2;

/** Texto del buscador listo para `q`: recortado; con menos de 2 caracteres no se busca. */
export function normalizeSearch(raw: string): string | undefined {
  const value = raw.trim();
  return value.length >= MIN_SEARCH_LENGTH ? value : undefined;
}
