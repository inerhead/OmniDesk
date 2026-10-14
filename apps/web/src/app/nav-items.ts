import type { ComponentType, SVGProps } from 'react';
import { MessageSquare } from 'lucide-react';
import { StatusPulseIcon } from './status-pulse-icon';

type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Destinos principales: los mismos en el rail de escritorio y en la barra inferior móvil. */
export const NAV_ITEMS: { to: string; label: string; icon: NavIcon }[] = [
  { to: '/conversations', label: 'Conversaciones', icon: MessageSquare },
  { to: '/status', label: 'Estado', icon: StatusPulseIcon },
];
