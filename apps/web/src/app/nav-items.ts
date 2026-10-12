import { Activity, MessageSquare, type LucideIcon } from 'lucide-react';

/** Destinos principales: los mismos en el rail de escritorio y en la barra inferior móvil. */
export const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/conversations', label: 'Conversaciones', icon: MessageSquare },
  { to: '/status', label: 'Estado', icon: Activity },
];
