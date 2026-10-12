import type { TimelineItem } from '@omnidesk/contracts';
import { describeEvent } from '../model/describe-event';
import { formatMessageTime } from '../model/format-time';

/** Línea de sistema centrada en el historial: quién tomó, liberó, cerró o reabrió. */
export function SystemLine({ event }: { event: Extract<TimelineItem, { kind: 'event' }> }) {
  return (
    <li className="flex justify-center">
      <span className="bg-muted text-muted-foreground max-w-[90%] rounded-full px-3 py-1 text-center text-xs">
        {describeEvent(event)} ·{' '}
        <time dateTime={event.createdAt}>{formatMessageTime(event.createdAt)}</time>
      </span>
    </li>
  );
}
