import type { AvatarColor } from '@/shared/lib/avatar';

/** Fondo y texto de un avatar con iniciales. */
export const AVATAR_COLOR_CLASS: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-200',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/25 dark:text-violet-200',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-500/25 dark:text-sky-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-200',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200',
};

/** Punto sólido del mismo color, para marcar un canal junto a texto. */
export const AVATAR_DOT_CLASS: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  sky: 'bg-sky-500',
  teal: 'bg-teal-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  orange: 'bg-orange-500',
};
