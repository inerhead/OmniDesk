/** n8n respondió algo que no mejora reintentando (4xx, 501, cuerpo inválido): la IA se abandona (SPEC 23). */
export class PermanentAiReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentAiReplyError';
  }
}
