import type { ConversationSummary, TimelineItem } from '@omnidesk/contracts';

type TimelineEvent = Extract<TimelineItem, { kind: 'event' }>;

/** Texto de la línea de sistema que ve quien lee el historial. */
export function describeEvent(event: TimelineEvent): string {
  const actor = event.actor?.displayName;
  const target = event.target?.displayName;

  switch (event.type) {
    case 'ASSIGNED':
      if (event.actor && event.target && event.actor.id === event.target.id) {
        return `${target} tomó la conversación`;
      }
      return `${actor ?? 'El sistema'} asignó la conversación a ${target ?? 'un agente'}`;
    case 'RELEASED':
      return `${actor ?? 'El sistema'} liberó la conversación a la IA`;
    case 'CLOSED':
      return `Cerrada por ${actor ?? 'el sistema'}`;
    case 'REOPENED':
      return actor ? `Reabierta por ${actor}` : 'Reabierta por un mensaje del cliente';
  }
}

/** Estado en el encabezado del chat y en la lista. */
export function statusLabel(
  conversation: Pick<ConversationSummary, 'status' | 'aiActive' | 'assignedAgent'>,
): string {
  if (conversation.status === 'CLOSED') return 'Cerrada';
  if (conversation.assignedAgent) return `Asignada a ${conversation.assignedAgent.displayName}`;
  if (conversation.aiActive) return 'IA activa';
  return 'Mensaje directo sin IA';
}
