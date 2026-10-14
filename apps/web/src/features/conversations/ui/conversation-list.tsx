import type { Inbox, InboxChannel } from '@omnidesk/contracts';
import {
  Archive,
  Bot,
  Inbox as InboxIcon,
  SearchX,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, useLocation, useSearchParams } from 'react-router';
import { useCurrentActor } from '@/features/auth/api/use-current-actor';
import { cn } from '@/shared/lib/utils';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { useConversations, useInboxChannels, useInboxCounts } from '../api/use-conversations';
import { CHANNEL_TYPE_LABEL, parseChannelId } from '../model/channel-selection';
import { formatListTime } from '../model/format-time';
import { EMPTY_INBOX_MESSAGE, parseInbox, visibleInboxes } from '../model/inbox';
import { normalizeSearch } from '../model/search';
import { contactLabel } from '../model/to-bubble-view';
import { ChannelDot, ChannelSwitcher } from './channel-switcher';
import { ConversationSearch } from './conversation-search';
import { InboxTabs } from './inbox-tabs';
import { StatusChip } from './status-chip';

const EMPTY_INBOX_ICON: Record<Inbox, LucideIcon> = {
  ai: Bot,
  mine: UserRound,
  all: InboxIcon,
  closed: Archive,
};

function ListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Cargando conversaciones">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex gap-3 px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-4/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConversationList() {
  const { actor, isLoading: actorLoading, isError: actorError, retry } = useCurrentActor();
  const [searchParams] = useSearchParams();
  const { search } = useLocation();
  const inbox = actor ? parseInbox(searchParams.get('inbox'), actor.role) : 'ai';
  const q = normalizeSearch(searchParams.get('q') ?? '');
  const channelId = parseChannelId(searchParams.get('channel'));
  const channels = useInboxChannels();
  const items = channels.data?.items ?? [];
  const multiChannel = items.length > 1;
  const current = multiChannel ? items.find((channel) => channel.id === channelId) : items[0];
  const conversations = useConversations(inbox, q, channelId);
  const counts = useInboxCounts(channelId);

  if (actorLoading) return <ListSkeleton />;

  if (actorError) {
    return (
      <EmptyState
        title="No se pudo cargar tu sesión"
        action={
          <Button size="sm" variant="outline" onClick={retry}>
            Reintentar
          </Button>
        }
      />
    );
  }

  if (!actor) {
    return <EmptyState icon={UserRound} title="Elige una empresa para ver la bandeja" />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="bg-background flex min-w-0 shrink-0 flex-col gap-3 border-b px-4 pt-4 pb-3">
        <ListHeading channel={current} multiChannel={multiChannel} />
        <div className="md:hidden">
          <ChannelSwitcher variant="bar" />
        </div>
        <ConversationSearch />
        <InboxTabs
          inboxes={visibleInboxes(actor.role)}
          active={inbox}
          q={q}
          channelId={channelId}
          counts={counts.data}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ListBody
          conversations={conversations}
          inbox={inbox}
          q={q}
          search={search}
          showChannel={multiChannel && !current}
        />
      </div>
    </div>
  );
}

/** Qué canal se está viendo: su nombre y tipo, o «Todos los canales». */
function ListHeading({
  channel,
  multiChannel,
}: {
  channel: InboxChannel | undefined;
  multiChannel: boolean;
}) {
  const title = channel?.name ?? (multiChannel ? 'Todos los canales' : 'Conversaciones');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{title}</h1>
      {(channel || multiChannel) && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {channel && multiChannel && <ChannelDot channelId={channel.id} />}
          Conversaciones
          {channel && ` · ${CHANNEL_TYPE_LABEL[channel.type]}`}
        </p>
      )}
    </div>
  );
}

function ListBody({
  conversations,
  inbox,
  q,
  search,
  showChannel,
}: {
  conversations: ReturnType<typeof useConversations>;
  inbox: Inbox;
  q: string | undefined;
  search: string;
  showChannel: boolean;
}) {
  if (conversations.isPending) return <ListSkeleton />;

  if (conversations.isError && !conversations.data) {
    return (
      <EmptyState
        title="No se pudieron cargar las conversaciones"
        action={
          <Button size="sm" variant="outline" onClick={() => void conversations.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  }

  const items = conversations.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return q ? (
      <EmptyState
        icon={SearchX}
        title={`Sin resultados para «${q}»`}
        description="Busca por nombre del contacto o por teléfono."
      />
    ) : (
      <EmptyState
        icon={EMPTY_INBOX_ICON[inbox]}
        title={EMPTY_INBOX_MESSAGE[inbox]}
        description={
          inbox === 'ai' && (
            <>
              Ejecuta <code className="bg-muted rounded px-1 py-0.5">pnpm simulate</code>.
            </>
          )
        }
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-0.5 p-2" aria-busy={conversations.isPlaceholderData}>
        {items.map((conversation) => {
          const name = contactLabel(conversation.contact);
          return (
            <li key={conversation.id}>
              <NavLink
                to={{ pathname: `/conversations/${conversation.id}`, search }}
                className={({ isActive }) =>
                  cn(
                    'focus-visible:ring-ring/50 flex gap-3 rounded-lg px-3 py-2.5 transition-colors outline-none focus-visible:ring-[3px]',
                    isActive
                      ? 'bg-primary/10 dark:bg-primary/15'
                      : 'hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Avatar
                  id={conversation.contact.id}
                  name={conversation.contact.displayName}
                  fallback={conversation.contact.externalId}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{name}</span>
                    <time
                      className="text-muted-foreground shrink-0 text-xs"
                      dateTime={conversation.lastMessageAt}
                    >
                      {formatListTime(conversation.lastMessageAt)}
                    </time>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground truncate text-sm">
                      {conversation.lastMessagePreview}
                    </span>
                    <StatusChip conversation={conversation} />
                  </span>
                  {showChannel && (
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                      <ChannelDot channelId={conversation.channel.id} />
                      <span className="truncate">{conversation.channel.name}</span>
                    </span>
                  )}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      {conversations.hasNextPage && (
        <div className="px-4 pb-4">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={conversations.isFetchingNextPage}
            onClick={() => void conversations.fetchNextPage()}
          >
            {conversations.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </Button>
        </div>
      )}
    </>
  );
}
