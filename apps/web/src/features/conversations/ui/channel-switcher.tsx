import type { InboxChannel } from '@omnidesk/contracts';
import { Layers } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { avatarColor } from '@/shared/lib/avatar';
import { cn } from '@/shared/lib/utils';
import { AVATAR_COLOR_CLASS, AVATAR_DOT_CLASS } from '@/shared/ui/avatar-colors';
import { Tooltip } from '@/shared/ui/tooltip';
import { useInboxChannels } from '../api/use-conversations';
import {
  CHANNEL_TYPE_LABEL,
  channelBadges,
  conversationListSearch,
  parseChannelId,
} from '../model/channel-selection';
import { WhatsAppMark } from './whatsapp-mark';

const railButton =
  'focus-visible:ring-ring/50 flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-[3px]';
const activeClass = 'bg-primary/12 text-primary dark:bg-primary/20';
const idleClass = 'hover:bg-accent hover:text-accent-foreground';

/**
 * Elige el canal de la bandeja (`?channel=`). En el rail, un avatar de color por canal bajo «Canales»;
 * en móvil, chips con el nombre. Con un solo canal no se muestra.
 */
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

  if (channels.length <= 1) return null;

  if (variant === 'bar') {
    return (
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Canales">
        <ChannelChip label="Todos" to={href(undefined)} active={onInbox && !selected} />
        {channels.map((channel) => (
          <ChannelChip
            key={channel.id}
            label={channel.name}
            channelId={channel.id}
            to={href(channel.id)}
            active={onInbox && selected === channel.id}
          />
        ))}
      </div>
    );
  }

  const badges = channelBadges(channels);
  const allActive = onInbox && !selected;
  return (
    <div
      className="mt-1 flex w-full flex-col items-center gap-2 border-t pt-3"
      role="group"
      aria-labelledby="rail-channels-label"
    >
      <span
        id="rail-channels-label"
        className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
      >
        Canales
      </span>
      <Tooltip content="Todos los canales" side="right">
        <Link
          to={href(undefined)}
          aria-label="Todos los canales"
          aria-current={allActive ? 'page' : undefined}
          className={cn(railButton, allActive ? activeClass : idleClass)}
        >
          <Layers className="size-5" aria-hidden />
        </Link>
      </Tooltip>
      {channels.map((channel) => (
        <RailChannel
          key={channel.id}
          channel={channel}
          badge={badges.get(channel.id)!}
          to={href(channel.id)}
          active={onInbox && selected === channel.id}
        />
      ))}
    </div>
  );
}

function RailChannel({
  channel,
  badge,
  to,
  active,
}: {
  channel: InboxChannel;
  badge: string;
  to: { pathname: string; search: string };
  active: boolean;
}) {
  const typeLabel = CHANNEL_TYPE_LABEL[channel.type];
  return (
    <Tooltip content={`${channel.name} · ${typeLabel}`} side="right">
      <Link
        to={to}
        aria-label={`${channel.name} (${typeLabel})`}
        aria-current={active ? 'page' : undefined}
        className={cn(railButton, !active && 'hover:bg-accent')}
      >
        <span
          className={cn(
            'relative flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-shadow',
            AVATAR_COLOR_CLASS[avatarColor(channel.id)],
            active && 'ring-primary ring-offset-sidebar ring-2 ring-offset-2',
          )}
        >
          {badge}
          {channel.type === 'WHATSAPP' && (
            <span className="bg-sidebar absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full p-px text-[#25D366]">
              <WhatsAppMark />
            </span>
          )}
        </span>
      </Link>
    </Tooltip>
  );
}

/** Punto con el color del canal: el mismo que su avatar en el rail. */
export function ChannelDot({ channelId, className }: { channelId: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        AVATAR_DOT_CLASS[avatarColor(channelId)],
        className,
      )}
    />
  );
}

function ChannelChip({
  label,
  channelId,
  to,
  active,
}: {
  label: string;
  channelId?: string;
  to: { pathname: string; search: string };
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-visible:ring-ring/50 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium outline-none focus-visible:ring-[3px]',
        active
          ? 'bg-primary/12 text-primary dark:bg-primary/20'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {channelId && <ChannelDot channelId={channelId} />}
      {label}
    </Link>
  );
}
