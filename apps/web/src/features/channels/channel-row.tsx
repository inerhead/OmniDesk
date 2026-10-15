import type { Channel } from '@omnidesk/contracts';
import { CheckCircle2, ChevronRight, CircleDashed } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { channelBadges, PROVIDER_LABEL } from './model/channel-status';

/** Fila de la lista: nombre, número, proveedor e insignias de estado. Abre el panel del canal. */
export function ChannelRow({ channel, onOpen }: { channel: Channel; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-accent/60 focus-visible:ring-ring/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate font-medium">{channel.name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {channel.phoneNumber ?? 'Sin número'} · {PROVIDER_LABEL[channel.provider]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {channelBadges(channel).map((badge) => (
              <span
                key={badge.key}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                  badge.ok
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'text-muted-foreground border-dashed',
                )}
              >
                {badge.ok ? (
                  <CheckCircle2 aria-hidden className="size-3" />
                ) : (
                  <CircleDashed aria-hidden className="size-3" />
                )}
                {badge.label}
              </span>
            ))}
          </div>
        </div>
        <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
      </button>
    </li>
  );
}
