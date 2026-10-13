import { MessageSquare } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { Tooltip } from '@/shared/ui/tooltip';
import { useInboxChannels } from '../api/use-conversations';
import {
  channelInitials,
  conversationListSearch,
  parseChannelId,
} from '../model/channel-selection';

const railButton =
  'focus-visible:ring-ring/50 flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px]';
const activeClass = 'bg-primary/12 text-primary dark:bg-primary/20';
const idleClass = 'hover:bg-accent hover:text-accent-foreground';

/** Elige el canal de la bandeja. En el rail van las iniciales; en móvil, el nombre. */
export function ChannelSwitcher({ variant }: { variant: 'rail' | 'bar' }) {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const { data } = useInboxChannels();
  const channels = data?.items ?? [];
  const selected = parseChannelId(searchParams.get('channel'));
  const onInbox = pathname.startsWith('/conversations');
  const href = (channelId: string | undefined) => ({
    pathname: '/conversations',
    search: conversationListSearch(searchParams, channelId),
  });

  if (channels.length <= 1) {
    if (variant === 'bar') return null;
    const only = channels[0];
    const label = only?.name ?? 'Conversaciones';
    return (
      <Tooltip content={label} side="right">
        <Link
          to={href(undefined)}
          aria-label={label}
          aria-current={onInbox ? 'page' : undefined}
          className={cn(railButton, onInbox ? activeClass : idleClass)}
        >
          <MessageSquare className="size-5" aria-hidden />
        </Link>
      </Tooltip>
    );
  }

  if (variant === 'bar') {
    return (
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Canales">
        <ChannelChip label="Todos" to={href(undefined)} active={onInbox && !selected} />
        {channels.map((channel) => (
          <ChannelChip
            key={channel.id}
            label={channel.name}
            to={href(channel.id)}
            active={onInbox && selected === channel.id}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2" role="group" aria-label="Canales">
      <Tooltip content="Todos los canales" side="right">
        <Link
          to={href(undefined)}
          aria-label="Todos los canales"
          aria-current={onInbox && !selected ? 'page' : undefined}
          className={cn(railButton, onInbox && !selected ? activeClass : idleClass)}
        >
          <MessageSquare className="size-5" aria-hidden />
        </Link>
      </Tooltip>
      {channels.map((channel) => {
        const active = onInbox && selected === channel.id;
        return (
          <Tooltip key={channel.id} content={channel.name} side="right">
            <Link
              to={href(channel.id)}
              aria-label={channel.name}
              aria-current={active ? 'page' : undefined}
              className={cn(railButton, active ? activeClass : idleClass)}
            >
              {channelInitials(channel.name)}
            </Link>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ChannelChip({
  label,
  to,
  active,
}: {
  label: string;
  to: { pathname: string; search: string };
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-visible:ring-ring/50 shrink-0 rounded-full px-3 py-1 text-xs font-medium outline-none focus-visible:ring-[3px]',
        active
          ? 'bg-primary/12 text-primary dark:bg-primary/20'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}
