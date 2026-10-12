import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { useCurrentActor } from '@/features/actor/api/use-actor';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { useConversationCommand } from '../api/use-conversation-command';
import { isNotFound, useConversation, useTimeline } from '../api/use-conversations';
import { statusLabel } from '../model/describe-event';
import { contactLabel } from '../model/to-bubble-view';
import { ConversationActions } from './conversation-actions';
import { MessageBubble } from './message-bubble';
import { SystemLine } from './system-line';

function BackLink() {
  // Vuelve a la misma bandeja (`?inbox=`) desde la que se abrió la conversación.
  const { search } = useLocation();
  return (
    <Button asChild size="sm" variant="ghost" className="md:hidden">
      <Link to={{ pathname: '/conversations', search }} aria-label="Volver">
        <ArrowLeft aria-hidden />
        Volver
      </Link>
    </Button>
  );
}

export function ChatView({ conversationId }: { conversationId: string }) {
  const { actor, members } = useCurrentActor();
  const timeline = useTimeline(conversationId);
  const conversation = useConversation(conversationId);
  const command = useConversationCommand(conversationId);
  const summary = conversation.data;

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const items = timeline.data
    ? [...timeline.data.pages].reverse().flatMap((page) => page.items)
    : [];
  const newestId = items.at(-1)?.id;

  // Al abrir otra conversación, volver a anclar al final.
  useEffect(() => {
    stickToBottom.current = true;
  }, [conversationId]);

  // Elementos nuevos: bajar solo si el usuario ya estaba al final (no al cargar anteriores).
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [newestId]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (element)
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  if (
    (timeline.isError && isNotFound(timeline.error)) ||
    (conversation.isError && isNotFound(conversation.error))
  ) {
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
        {summary && (
          <Badge
            variant={
              summary.status === 'CLOSED' ? 'outline' : summary.aiActive ? 'secondary' : 'warning'
            }
          >
            {statusLabel(summary)}
          </Badge>
        )}
        {summary && actor && (
          <ConversationActions
            conversation={summary}
            actor={actor}
            members={members}
            pending={command.pending}
            onRun={command.run}
          />
        )}
      </header>

      {command.notice && (
        <div
          role="status"
          className="bg-warning text-warning-foreground flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-sm"
        >
          <span>{command.notice}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Cerrar aviso"
            className="size-6 p-0"
            onClick={command.dismissNotice}
          >
            <X aria-hidden />
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
      >
        {timeline.isPending && (
          <p className="text-muted-foreground text-center text-sm">Cargando mensajes…</p>
        )}

        {timeline.isError && !timeline.data && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">No se pudieron cargar los mensajes</p>
            <Button size="sm" variant="outline" onClick={() => void timeline.refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {timeline.hasNextPage && (
          <div className="mb-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              disabled={timeline.isFetchingNextPage}
              onClick={() => {
                stickToBottom.current = false;
                void timeline.fetchNextPage();
              }}
            >
              {timeline.isFetchingNextPage ? 'Cargando…' : 'Cargar anteriores'}
            </Button>
          </div>
        )}

        <ol className="flex flex-col gap-2">
          {items.map((item) =>
            item.kind === 'event' ? (
              <SystemLine key={item.id} event={item} />
            ) : (
              <MessageBubble key={item.id} message={item} />
            ),
          )}
        </ol>
      </div>
    </div>
  );
}
