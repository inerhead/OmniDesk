import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { ComponentProps } from 'react';
import { avatarColor, initials, type AvatarColor } from '@/shared/lib/avatar';
import { cn } from '@/shared/lib/utils';

const COLOR_CLASS: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-200',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/25 dark:text-violet-200',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-500/25 dark:text-sky-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-200',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200',
};

const SIZE_CLASS = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-xl',
} as const;

/** Avatar con iniciales y un color estable derivado de `id`. */
function Avatar({
  id,
  name,
  fallback,
  size = 'md',
  imageUrl,
  className,
  ...props
}: Omit<ComponentProps<typeof AvatarPrimitive.Root>, 'id'> & {
  id: string;
  name: string | null;
  /** Foto (p. ej. la de Google); mientras carga o si falla, las iniciales. */
  imageUrl?: string | null;
  /** Texto si no hay nombre (p. ej. el teléfono). */
  fallback: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full select-none',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {imageUrl && (
        <AvatarPrimitive.Image
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        aria-hidden
        className={cn(
          'flex size-full items-center justify-center font-semibold',
          COLOR_CLASS[avatarColor(id)],
        )}
      >
        {initials(name, fallback)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
