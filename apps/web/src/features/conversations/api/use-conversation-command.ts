import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCurrentActor } from '@/features/actor/api/use-actor';
import {
  ConversationCommandError,
  postConversationCommand,
  type ConversationCommandName,
} from './conversations-api';
import { conversationDetailKey } from './use-conversations';

export interface RunCommandInput {
  command: ConversationCommandName;
  /** Versión de control que el usuario tenía en pantalla. */
  controlVersion: number;
  /** Solo para `assign`. */
  memberId?: string;
}

export const CONFLICT_NOTICE = 'La conversación cambió. Se actualizó con el estado actual';

export function noticeFor(error: unknown): string {
  if (error instanceof ConversationCommandError) {
    if (error.status === 409) return CONFLICT_NOTICE;
    if (error.status === 403) return 'Tu rol no permite esta acción';
    if (error.status === 404) return 'La conversación ya no está disponible para ti';
  }
  return 'No se pudo completar la acción. Inténtalo de nuevo';
}

/** Ejecuta un comando de asignación/cierre y deja a la conversación en su estado actual. */
export function useConversationCommand(conversationId: string) {
  const queryClient = useQueryClient();
  const { actor } = useCurrentActor();
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      queryClient.invalidateQueries({ queryKey: ['timeline', conversationId] }),
    ]);

  const mutation = useMutation({
    mutationFn: ({ command, controlVersion, memberId }: RunCommandInput) =>
      postConversationCommand(actor!.id, conversationId, command, {
        controlVersion,
        ...(memberId && { memberId }),
      }),
    onSuccess: (summary) => {
      setNotice(null);
      queryClient.setQueryData(conversationDetailKey(actor?.id, conversationId), summary);
      return refresh();
    },
    onError: (error) => {
      setNotice(noticeFor(error));
      // Un conflicto significa que la pantalla estaba vieja: se vuelve a pedir el estado actual.
      return refresh();
    },
  });

  return {
    run: (input: RunCommandInput) => mutation.mutate(input),
    pending: mutation.isPending,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
