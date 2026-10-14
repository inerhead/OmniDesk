import { Outlet, useParams } from 'react-router';
import { ConversationList } from '@/features/conversations/ui/conversation-list';
import { cn } from '@/shared/lib/utils';

/**
 * Escritorio (≥ md): lista y chat en dos paneles (el panel de contacto lo añade el chat en ≥ xl).
 * Móvil: la lista ocupa la pantalla; al abrir una conversación, el chat la reemplaza.
 */
export function ConversationsPage() {
  const { conversationId } = useParams();

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          'min-h-0 min-w-0 w-full flex-col overflow-hidden md:flex md:w-80 md:shrink-0 md:border-r lg:w-96',
          conversationId ? 'hidden' : 'flex',
        )}
        aria-label="Conversaciones"
      >
        <ConversationList />
      </aside>
      <section
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col md:flex',
          conversationId ? 'flex' : 'hidden',
        )}
      >
        <Outlet />
      </section>
    </div>
  );
}
