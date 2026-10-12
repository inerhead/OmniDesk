import { MessageSquare } from 'lucide-react';
import { useParams } from 'react-router';
import { ChatView } from '@/features/conversations/ui/chat-view';
import { EmptyState } from '@/shared/ui/empty-state';

export function ConversationPage() {
  const { conversationId } = useParams();
  if (!conversationId) return null;
  // `key` reinicia el estado del chat (scroll, paginación) al cambiar de conversación.
  return <ChatView key={conversationId} conversationId={conversationId} />;
}

/** Panel derecho en escritorio cuando no hay conversación abierta. */
export function ConversationPlaceholder() {
  return (
    <div className="bg-muted/30 flex h-full items-center justify-center">
      <EmptyState
        icon={MessageSquare}
        title="Selecciona una conversación"
        description="Elige una conversación de la lista para ver el historial y responder."
      />
    </div>
  );
}
