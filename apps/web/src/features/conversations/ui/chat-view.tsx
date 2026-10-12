import { ArrowLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { isNotFound, useConversations, useMessages } from '../api/use-conversations';
import { contactLabel } from '../model/to-bubble-view';
import { MessageBubble } from './message-bubble';

function BackLink() {
  return (
    <Button asChild size="sm" variant="ghost" className="md:hidden">
      <Link to="/conversations" aria-label="Volver">
        <ArrowLeft aria-hidden />
        Volver
      </Link>
    </Button>
  );
}

export function ChatView({ conversationId }: { conversationId: string }) {
  const messages = useMessages(conversationId);
  // La lista comparte caché con el panel izquierdo; aporta contacto y canal para el encabezado.
  const conversations = useConversations();
  const summary = conversations.data?.pages
    .flatMap((page) => page.items)
    .find((item) => item.id === conversationId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const items = messages.data
    ? [...messages.data.pages].reverse().flatMap((page) => page.items)
    : [];
  const newestId = items.at(-1)?.id;

  // Al abrir otra conversación, volver a anclar al final.
  useEffect(() => {
    stickToBottom.current = true;
  }, [conversationId]);

  // Mensajes nuevos: bajar solo si el usuario ya estaba al final (no al cargar anteriores).
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [newestId]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (element)
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  if (messages.isError && isNotFound(messages.error)) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-2 py-2">
          <BackLink />
        </div>
        <p className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center">
          Conversación no encontrada
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-2 py-2 md:px-4">
        <BackLink />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {summary ? contactLabel(summary.contact) : 'Conversación'}
          </p>
          {summary && (
            <p className="text-muted-foreground truncate text-xs">
              {summary.contact.externalId} · {summary.channel.name}
            </p>
          )}
        </div>
        {summary?.aiActive && <Badge variant="secondary">IA activa</Badge>}
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
      >
        {messages.isPending && (
          <p className="text-muted-foreground text-center text-sm">Cargando mensajes…</p>
        )}

        {messages.isError && !messages.data && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">No se pudieron cargar los mensajes</p>
            <Button size="sm" variant="outline" onClick={() => void messages.refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {messages.hasNextPage && (
          <div className="mb-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              disabled={messages.isFetchingNextPage}
              onClick={() => {
                stickToBottom.current = false;
                void messages.fetchNextPage();
              }}
            >
              {messages.isFetchingNextPage ? 'Cargando…' : 'Cargar anteriores'}
            </Button>
          </div>
        )}

        <ol className="flex flex-col gap-2">
          {items.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </ol>
      </div>
    </div>
  );
}
