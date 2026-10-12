import { MessageSquare } from 'lucide-react';
import { useParams } from 'react-router';
import { ChatView } from '@/features/conversations/ui/chat-view';

export function ConversationPage() {
  const { conversationId } = useParams();
  if (!conversationId) return null;
  // `key` reinicia el estado del chat (scroll, paginación) al cambiar de conversación.
  return <ChatView key={conversationId} conversationId={conversationId} />;
}

/** Panel derecho en escritorio cuando no hay conversación abierta. */
export function ConversationPlaceholder() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
      <MessageSquare className="size-8" aria-hidden />
      <p className="text-sm">Selecciona una conversación</p>
    </div>
  );
}
