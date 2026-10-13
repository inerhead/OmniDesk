import type { Inbox, InboxCountsResponse } from '@omnidesk/contracts';
import { Link, useLocation } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { formatInboxCount, INBOX_LABEL } from '../model/inbox';

/**
 * Bandejas como control segmentado. La activa vive en la URL (`?inbox=`) y se conserva al abrir una
 * conversación; la búsqueda (`?q=`) se mantiene al cambiar de bandeja. Cada pestaña lleva su contador
 * (salvo "Cerradas"); "Mías" se destaca si tiene conversaciones y no es la activa.
 */
export function InboxTabs({
  inboxes,
  active,
  q,
  channelId,
  counts,
}: {
  inboxes: Inbox[];
  active: Inbox;
  q: string | undefined;
  channelId: string | undefined;
  counts: InboxCountsResponse | undefined;
}) {
  const { pathname } = useLocation();
  const searchFor = (inbox: Inbox) => {
    const params = new URLSearchParams();
    if (inbox !== 'ai') params.set('inbox', inbox);
    if (q) params.set('q', q);
    if (channelId) params.set('channel', channelId);
    const search = params.toString();
    return search ? `?${search}` : '';
  };

  return (
    <SegmentedControl
      label="Bandejas"
      value={active}
      options={inboxes.map((inbox) => ({ value: inbox, label: INBOX_LABEL[inbox] }))}
      renderOption={(option, { className, active: isActive }) => {
        const count = option.value === 'closed' ? undefined : counts?.[option.value];
        const badge = formatInboxCount(count);
        return (
          <Link
            key={option.value}
            to={{ pathname, search: searchFor(option.value) }}
            aria-current={isActive ? 'page' : undefined}
            aria-label={badge ? `${option.label}: ${count} conversaciones` : undefined}
            className={cn(className, 'inline-flex items-center justify-center gap-1.5')}
          >
            {option.label}
            {badge && (
              <span
                aria-hidden
                className={cn(
                  'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-semibold tabular-nums transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : option.value === 'mine'
                      ? 'bg-primary/15 text-primary dark:bg-primary/25'
                      : 'bg-foreground/10 text-muted-foreground',
                )}
              >
                {badge}
              </span>
            )}
          </Link>
        );
      }}
    />
  );
}
