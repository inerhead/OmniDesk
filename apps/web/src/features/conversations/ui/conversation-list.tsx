import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { useConversations } from '../api/use-conversations';
import { formatConversationTime } from '../model/format-time';
import { contactLabel } from '../model/to-bubble-view';

function initials(name: string): string {
  const letters = name.match(/\p{L}/gu) ?? [];
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  return (
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : letters.slice(0, 2).join('') || '#'
  ).toUpperCase();
}

function ListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Cargando conversaciones">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex animate-pulse gap-3 border-b px-4 py-3">
          <div className="bg-muted size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <div className="bg-muted h-3 w-1/2 rounded" />
            <div className="bg-muted h-3 w-4/5 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConversationList() {
  const conversations = useConversations();

  if (conversations.isPending) return <ListSkeleton />;

  if (conversations.isError && !conversations.data) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm font-medium">No se pudieron cargar las conversaciones</p>
        <Button size="sm" variant="outline" onClick={() => void conversations.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const items = conversations.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-10 text-center text-sm">
        Aún no hay conversaciones. Ejecuta{' '}
        <code className="bg-muted rounded px-1 py-0.5">pnpm simulate</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <ul>
        {items.map((conversation) => {
          const name = contactLabel(conversation.contact);
          return (
            <li key={conversation.id}>
              <NavLink
                to={`/conversations/${conversation.id}`}
                className={({ isActive }) =>
                  cn(
                    'flex gap-3 border-b px-4 py-3 transition-colors',
                    isActive ? 'bg-accent' : 'hover:bg-accent/50',
                  )
                }
              >
                <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                  {initials(name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{name}</span>
                    <time
                      className="text-muted-foreground shrink-0 text-xs"
                      dateTime={conversation.lastMessageAt}
                    >
                      {formatConversationTime(conversation.lastMessageAt)}
                    </time>
                  </span>
                  <span className="text-muted-foreground truncate text-sm">
                    {conversation.lastMessagePreview}
                  </span>
                  <span className="text-muted-foreground text-xs">{conversation.channel.name}</span>
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      {conversations.hasNextPage && (
        <div className="p-3">
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
    </div>
  );
}
