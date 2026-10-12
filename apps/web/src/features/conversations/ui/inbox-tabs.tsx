import type { Inbox } from '@omnidesk/contracts';
import { Link, useLocation } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { INBOX_LABEL } from '../model/inbox';

/** Pestañas de bandeja. La activa vive en la URL (`?inbox=`) y se conserva al abrir una conversación. */
export function InboxTabs({ inboxes, active }: { inboxes: Inbox[]; active: Inbox }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Bandejas" className="bg-background sticky top-0 z-10 flex border-b">
      {inboxes.map((inbox) => (
        <Link
          key={inbox}
          to={{ pathname, search: inbox === 'ai' ? '' : `?inbox=${inbox}` }}
          aria-current={inbox === active ? 'page' : undefined}
          className={cn(
            'flex-1 border-b-2 px-2 py-2.5 text-center text-sm font-medium transition-colors',
            inbox === active
              ? 'border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground border-transparent',
          )}
        >
          {INBOX_LABEL[inbox]}
        </Link>
      ))}
    </nav>
  );
}
