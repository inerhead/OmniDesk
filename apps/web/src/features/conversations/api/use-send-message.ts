import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiUnavailableError } from '@/shared/api/http-client';
import { newRequestId } from '@/shared/api/request-id';
import { postAgentMessage, postRetryMessage, SendMessageError } from './conversations-api';

export function sendNoticeFor(error: unknown): string {
  if (error instanceof SendMessageError) {
    if (error.status === 403) return 'Solo el agente asignado puede responder';
    if (error.status === 404) return 'La conversación ya no está disponible para ti';
    if (error.status === 409) return 'La conversación está cerrada o cambió';
  }
  if (error instanceof ApiUnavailableError)
    return 'Sin conexión con el servidor. Inténtalo de nuevo';
  return 'No se pudo enviar el mensaje. Inténtalo de nuevo';
}

/** Envía mensajes del agente y reintenta los fallidos; refresca el chat al terminar. */
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  // Un mismo mensaje conserva su clientMessageId hasta enviarse: reintentar ante un error de red no lo duplica.
  const clientMessageId = useRef(newRequestId());

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      queryClient.invalidateQueries({ queryKey: ['timeline', conversationId] }),
    ]);

  const send = useMutation({
    mutationFn: (text: string) =>
      postAgentMessage(conversationId, {
        text,
        clientMessageId: clientMessageId.current,
      }),
    onSuccess: () => {
      clientMessageId.current = newRequestId();
      setNotice(null);
      return refresh();
    },
    onError: (error) => {
      setNotice(sendNoticeFor(error));
      // Un 403/404/409 significa que la pantalla estaba vieja.
      if (error instanceof SendMessageError) return refresh();
    },
  });

  const retry = useMutation({
    mutationFn: (messageId: string) => postRetryMessage(conversationId, messageId),
    onSuccess: () => {
      setNotice(null);
      return refresh();
    },
    onError: (error) => {
      setNotice(sendNoticeFor(error));
      return refresh();
    },
  });

  return {
    send: (text: string, options?: { onSent: () => void }) =>
      send.mutate(text, { onSuccess: options?.onSent }),
    sending: send.isPending,
    retry: (messageId: string) => retry.mutate(messageId),
    retryingId: retry.isPending ? retry.variables : null,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
