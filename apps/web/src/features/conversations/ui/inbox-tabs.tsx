import type { Inbox } from '@omnidesk/contracts';
import { Link, useLocation } from 'react-router';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { INBOX_LABEL } from '../model/inbox';

/**
 * Bandejas como control segmentado. La activa vive en la URL (`?inbox=`) y se conserva al abrir una
 * conversación; la búsqueda (`?q=`) se mantiene al cambiar de bandeja.
 */
export function InboxTabs({
  inboxes,
  active,
  q,
}: {
  inboxes: Inbox[];
  active: Inbox;
  q: string | undefined;
}) {
  const { pathname } = useLocation();
  const searchFor = (inbox: Inbox) => {
    const params = new URLSearchParams();
    if (inbox !== 'ai') params.set('inbox', inbox);
    if (q) params.set('q', q);
    const search = params.toString();
    return search ? `?${search}` : '';
  };

  return (
    <SegmentedControl
      label="Bandejas"
      value={active}
      options={inboxes.map((inbox) => ({ value: inbox, label: INBOX_LABEL[inbox] }))}
      renderOption={(option, { className, active: isActive }) => (
        <Link
          key={option.value}
          to={{ pathname, search: searchFor(option.value) }}
          aria-current={isActive ? 'page' : undefined}
          className={className}
        >
          {option.label}
        </Link>
      )}
    />
  );
}
