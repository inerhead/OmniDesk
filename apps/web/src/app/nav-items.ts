import type { ComponentType, SVGProps } from 'react';
import { ChatReplyIcon } from './chat-reply-icon';
import { StatusPulseIcon } from './status-pulse-icon';

// Sin `mode`: el atributo SVG choca con el `mode` de `ChatReplyIcon` (SPEC 21).
type NavIcon = ComponentType<Omit<SVGProps<SVGSVGElement>, 'mode'>>;

/** Destinos principales: los mismos en el rail de escritorio y en la barra inferior móvil. */
export const NAV_ITEMS: { to: string; label: string; icon: NavIcon }[] = [
  { to: '/conversations', label: 'Conversaciones', icon: ChatReplyIcon },
  { to: '/status', label: 'Estado', icon: StatusPulseIcon },
];
