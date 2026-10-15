import { ArrowDown, ArrowLeft, MessageSquareOff, PanelRight, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useCurrentActor } from '@/features/auth/api/use-current-actor';
import { useNow } from '@/shared/lib/use-now';
import { cn } from '@/shared/lib/utils';
import { useMediaQuery, XL_QUERY } from '@/shared/lib/use-media-query';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tooltip } from '@/shared/ui/tooltip';
import { useConversationCommand } from '../api/use-conversation-command';
import { useSendMessage } from '../api/use-send-message';
import { isNotFound, useConversation, useTimeline } from '../api/use-conversations';
import { WINDOW_CLOSED_NOTICE, composerMode } from '../model/composer-mode';
import { setContactPanelOpen, useContactPanelOpen } from '../model/contact-panel-store';
import { useConversationDeleted } from '../model/deleted-conversations';
import { groupConsecutiveBubbles, groupTimelineByDay } from '../model/group-timeline';
import { contactLabel } from '../model/to-bubble-view';
import { ContactPanel } from './contact-panel';
import { ConversationActions } from './conversation-actions';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import { StatusChip } from './status-chip';
import { SystemLine } from './system-line';

/** Distancia al final (px) por debajo de la cual se sigue anclado a los mensajes nuevos. */
const STICK_THRESHOLD_PX = 80;
/** Distancia al final (px) a partir de la cual aparece "Ir al final". */
const JUMP_THRESHOLD_PX = 200;
/**
 * En claro la barra es casi opaca: sobre un fondo plano el cristal se confunde con el chat.
 * En oscuro sí se transparenta, como en WhatsApp.
 */
const FROST =
  'border-border/70 bg-background/95 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-background/60 dark:shadow-none dark:backdrop-blur-xl';

function BackLink() {
  // Vuelve a la misma bandeja (`?inbox=`, `?q=`) desde la que se abrió la conversación.
  const { search } = useLocation();
  return (
    <Button asChild size="icon" variant="ghost" className="md:hidden">
      <Link to={{ pathname: '/conversations', search }} aria-label="Volver">
        <ArrowLeft aria-hidden />
      </Link>
    </Button>
  );
}

function newMessagesLabel(count: number): string {
  return count === 1 ? '1 mensaje nuevo' : `${count} mensajes nuevos`;
}

export function ChatView({ conversationId }: { conversationId: string }) {
  const { actor, members } = useCurrentActor();
  const timeline = useTimeline(conversationId);
  const conversation = useConversation(conversationId);
  const deleted = useConversationDeleted(conversationId);
  const command = useConversationCommand(conversationId);
  const messaging = useSendMessage(conversationId);
  const notice = command.notice ?? messaging.notice;
  const dismissNotice = command.notice ? command.dismissNotice : messaging.dismissNotice;
  const now = useNow(60_000);
  const summary = conversation.data;
  const mode =
    summary && actor ? composerMode(summary, actor, new Date(now)) : { kind: 'none' as const };

  // Panel de contacto: columna persistida en ≥ xl; hoja lateral por debajo.
  const isXl = useMediaQuery(XL_QUERY);
  const panelOpen = useContactPanelOpen();
  const [sheetOpen, setSheetOpen] = useState(false);
  const panelVisible = isXl ? panelOpen : sheetOpen;
  const togglePanel = () => (isXl ? setContactPanelOpen(!panelOpen) : setSheetOpen(!sheetOpen));

  const frameRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const pinning = useRef(false);
  const userMoved = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [farFromBottom, setFarFromBottom] = useState(false);
  const items = timeline.data
    ? [...timeline.data.pages].reverse().flatMap((page) => page.items)
    : [];
  const newest = items.at(-1);
  const newestSequence = newest?.sequence ?? 0;

  // Último elemento visto al final del historial: lo posterior cuenta como "nuevo".
  const [seenSequence, setSeenSequence] = useState(0);
  if (atBottom && seenSequence !== newestSequence) setSeenSequence(newestSequence);
  const newCount = items.filter(
    (item) => item.kind === 'message' && item.sequence > seenSequence,
  ).length;

  const scrollToEnd = () => {
    const element = scrollRef.current;
    if (!element) return;
    pinning.current = true;
    element.scrollTop = element.scrollHeight;
    requestAnimationFrame(() => {
      pinning.current = false;
    });
  };

  // Al abrir el chat se muestra el último mensaje, antes del primer pintado.
  // Si el usuario subió a leer el historial, un mensaje nuevo no lo arrastra.
  useLayoutEffect(() => {
    userMoved.current = false;
    stickToBottom.current = true;
    scrollToEnd();
  }, [conversationId]);

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToEnd();
  }, [newest?.id]);

  // Una foto, un audio o el compositor al crecer dejarían el último mensaje cortado.
  useEffect(() => {
    const content = contentRef.current;
    const header = headerRef.current;
    const dock = dockRef.current;
    const frame = frameRef.current;
    if (!content || !header || !dock || !frame) return;
    const pin = () => {
      frame.style.setProperty('--chat-header', `${header.offsetHeight}px`);
      frame.style.setProperty('--chat-dock', `${dock.offsetHeight}px`);
      const element = scrollRef.current;
      if (element && stickToBottom.current) {
        pinning.current = true;
        element.scrollTop = element.scrollHeight;
        requestAnimationFrame(() => {
          pinning.current = false;
        });
      }
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    observer.observe(header);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [conversationId]);

  const onScroll = () => {
    if (pinning.current) return;
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    // Al entrar, el historial crece y el scroll salta solo. Eso no es el usuario subiendo.
    if (!userMoved.current) {
      stickToBottom.current = true;
      setAtBottom(true);
      setFarFromBottom(false);
      const next = element.scrollHeight;
      if (distance >= STICK_THRESHOLD_PX && element.scrollTop !== next) {
        pinning.current = true;
        element.scrollTop = next;
        pinning.current = false;
      }
      return;
    }
    stickToBottom.current = distance < STICK_THRESHOLD_PX;
    setAtBottom(distance < STICK_THRESHOLD_PX);
    setFarFromBottom(distance > JUMP_THRESHOLD_PX);
  };

  const jumpToEnd = () => {
    const element = scrollRef.current;
    stickToBottom.current = true;
    element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  };

  if (
    deleted ||
    (timeline.isError && isNotFound(timeline.error)) ||
    (conversation.isError && isNotFound(conversation.error))
  ) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-2 py-2">
          <BackLink />
        </div>
        {deleted ? (
          <EmptyState
            icon={MessageSquareOff}
            title="Esta conversación fue eliminada"
            description="Se borró el contacto y todo su historial."
            className="flex-1 justify-center"
          />
        ) : (
          <EmptyState
            icon={MessageSquareOff}
            title="Conversación no encontrada"
            description="Puede que se haya eliminado o que ya no tengas acceso."
            className="flex-1 justify-center"
          />
        )}
      </div>
    );
  }

  const contactName = summary ? contactLabel(summary.contact) : '';
  const panel = (
    <ContactPanel
      conversationId={conversationId}
      actor={actor}
      members={members}
      command={command}
    />
  );

  return (
    <div className="flex h-full min-h-0">
      <div
        ref={frameRef}
        className="bg-muted/70 relative min-h-0 min-w-0 flex-1 dark:bg-muted/25 [--chat-dock:4.5rem] [--chat-header:4rem]"
      >
        <div ref={headerRef} className="absolute inset-x-0 top-0 z-20">
        <header
          className={cn(
            FROST,
            'flex min-h-16 items-center gap-2 border-b px-2 py-2 md:gap-3 md:px-4',
          )}
        >
          <BackLink />
          {summary ? (
            <Avatar
              id={summary.contact.id}
              name={summary.contact.displayName}
              fallback={summary.contact.externalId}
            />
          ) : (
            <Skeleton className="size-10 shrink-0 rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            {summary ? (
              <>
                <p className="truncate font-semibold">{contactName}</p>
                <p className="text-muted-foreground truncate text-xs tabular-nums">
                  {summary.channel.name} · {summary.contact.externalId}
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            )}
          </div>
          {summary && <StatusChip conversation={summary} className="hidden sm:inline-flex" />}
          {summary && actor && (
            <ConversationActions
              conversation={summary}
              actor={actor}
              members={members}
              pending={command.pending}
              onRun={command.run}
            />
          )}
          <Tooltip content={panelVisible ? 'Ocultar contacto' : 'Ver contacto'} side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Panel de contacto"
              aria-pressed={panelVisible}
              className={cn(panelVisible && 'bg-accent text-accent-foreground')}
              onClick={togglePanel}
            >
              <PanelRight aria-hidden />
            </Button>
          </Tooltip>
        </header>

        {notice && (
          <div
            role="status"
            className="bg-warning text-warning-foreground flex items-center justify-between gap-2 px-4 py-2 text-sm"
          >
            <span>{notice}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Cerrar aviso"
              className="size-6 p-0"
              onClick={dismissNotice}
            >
              <X aria-hidden />
            </Button>
          </div>
        )}
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={() => {
            userMoved.current = true;
          }}
          onTouchStart={() => {
            userMoved.current = true;
          }}
          onPointerDown={() => {
            userMoved.current = true;
          }}
          className="absolute inset-0 overflow-y-auto px-3 pt-[var(--chat-header)] pb-[calc(var(--chat-dock)+1rem)] [overflow-anchor:none] md:px-6"
        >
            <div ref={contentRef} className="mx-auto w-full max-w-3xl">
              {timeline.isPending && (
                <p className="text-muted-foreground py-4 text-center text-sm">Cargando mensajes…</p>
              )}

              {timeline.isError && !timeline.data && (
                <EmptyState
                  title="No se pudieron cargar los mensajes"
                  action={
                    <Button size="sm" variant="outline" onClick={() => void timeline.refetch()}>
                      Reintentar
                    </Button>
                  }
                />
              )}

              {timeline.hasNextPage && (
                <div className="flex justify-center pt-4">
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

              {groupTimelineByDay(items, new Date()).map((day) => (
                <section key={`${day.dayLabel}-${day.items[0]!.id}`} aria-label={day.dayLabel}>
                  <div className="sticky top-[var(--chat-header)] z-10 flex justify-center pt-4 pb-1">
                    <span className="bg-muted text-muted-foreground rounded-full px-3 py-0.5 text-xs font-medium shadow-xs">
                      {day.dayLabel}
                    </span>
                  </div>
                  <ol className="flex flex-col">
                    {groupConsecutiveBubbles(day.items).map(
                      ({ item, showAuthor, isLastOfGroup }) =>
                        item.kind === 'event' ? (
                          <SystemLine key={item.id} event={item} />
                        ) : (
                          <MessageBubble
                            key={item.id}
                            message={item}
                            contactName={contactName}
                            showAuthor={showAuthor}
                            isLastOfGroup={isLastOfGroup}
                            onRetry={mode.kind === 'compose' ? messaging.retry : undefined}
                            retrying={messaging.retryingId === item.id}
                          />
                        ),
                    )}
                  </ol>
                </section>
              ))}
            </div>
          </div>

          {!atBottom && (farFromBottom || newCount > 0) && (
            <Button
              size="sm"
              variant={newCount > 0 ? 'default' : 'outline'}
              className="animate-in fade-in-0 absolute bottom-[calc(var(--chat-dock)+1rem)] left-1/2 z-20 -translate-x-1/2 rounded-full shadow-md"
              onClick={jumpToEnd}
            >
              <ArrowDown aria-hidden />
              {newCount > 0 ? newMessagesLabel(newCount) : 'Ir al final'}
            </Button>
          )}

        <div
          ref={dockRef}
          className={cn(
            'absolute inset-x-0 bottom-0 z-20',
            mode.kind !== 'none' && cn(FROST, 'pb-[var(--safe-bottom)]'),
          )}
        >
        {mode.kind === 'compose' && (
          <MessageComposer sending={messaging.sending} onSend={messaging.send} />
        )}

        {mode.kind === 'take' && summary && actor && (
          <div className="px-3 pt-3 pb-3 md:px-6">
            <Button
              className="w-full"
              disabled={command.pending}
              onClick={() =>
                command.run({
                  command: 'assign',
                  controlVersion: summary.controlVersion,
                  memberId: actor.id,
                })
              }
            >
              Tomar conversación para responder
            </Button>
          </div>
        )}

        {mode.kind === 'assigned-other' && (
          <p className="text-muted-foreground px-3 pt-3 pb-3 text-center text-sm md:px-6">
            Asignada a {mode.name}
          </p>
        )}

        {mode.kind === 'window-closed' && (
          <p className="text-muted-foreground px-3 pt-3 pb-3 text-center text-sm md:px-6">
            {WINDOW_CLOSED_NOTICE}
          </p>
        )}
        {/* El teclado no encoge la página: este hueco empuja el composer y el ResizeObserver
            ancla los mensajes. Cambiar el alto de #root se veía como una recarga. */}
        <div aria-hidden className="h-[var(--keyboard-overlap)]" />
        </div>
      </div>

      {isXl && panelOpen && (
        <aside aria-label="Contacto" className="w-80 shrink-0 overflow-y-auto border-l">
          {panel}
        </aside>
      )}

      {!isXl && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="overflow-y-auto">
            <SheetTitle className="sr-only">Contacto</SheetTitle>
            <SheetDescription className="sr-only">Datos del contacto y acciones</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
