import {
  useNewMessageSignal,
  type NewMessageSignal,
} from '@/features/conversations/model/new-message-signal';
import { ChatReplyIcon, type ChatReplyIconMode } from './chat-reply-icon';
import { CONVERSATIONS, type NavItem } from './nav-item-label';

function iconMode(signal: NewMessageSignal): ChatReplyIconMode {
  if (signal.kind === 'pending') return 'loop';
  return signal.kind === 'pulse' ? 'once' : 'idle';
}

/**
 * Icono de un destino del rail o de la barra inferior. El de Conversaciones refleja el aviso de
 * mensaje nuevo (SPEC 21): bucle hasta entrar, una pasada por mensaje si ya está dentro y, con
 * movimiento reducido, un punto fijo en vez del bucle.
 */
export function NavItemIcon({ item, className }: { item: NavItem; className?: string }) {
  const signal = useNewMessageSignal();
  const Icon = item.icon;
  if (item.to !== CONVERSATIONS) return <Icon className={className} aria-hidden />;

  return (
    <span className="relative flex">
      {/* `key`: cada mensaje nuevo remonta el SVG para que la pasada empiece de cero. */}
      <ChatReplyIcon
        key={signal.kind === 'pulse' ? `pulse-${signal.seq}` : signal.kind}
        mode={iconMode(signal)}
        className={className}
        aria-hidden
      />
      {signal.kind === 'pending' && (
        <span
          aria-hidden
          className="bg-primary absolute -top-0.5 -right-0.5 hidden size-2 rounded-full ring-2 ring-[var(--nav-icon-bg)] motion-reduce:block"
        />
      )}
    </span>
  );
}
