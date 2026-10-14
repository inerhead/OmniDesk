import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { ComponentProps } from 'react';
import { apiBase } from '@/shared/config/env';
import { avatarColor, avatarSrc, initials } from '@/shared/lib/avatar';
import { cn } from '@/shared/lib/utils';
import { AVATAR_COLOR_CLASS } from './avatar-colors';

const SIZE_CLASS = {
  xs: 'size-5 text-[10px]',
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
  /** Foto subida (relativa al API) o de Google; mientras carga o si falla, las iniciales. */
  imageUrl?: string | null;
  /** Texto si no hay nombre (p. ej. el teléfono). */
  fallback: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  const src = avatarSrc(imageUrl, apiBase);
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
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        aria-hidden
        className={cn(
          'flex size-full items-center justify-center font-semibold',
          AVATAR_COLOR_CLASS[avatarColor(id)],
        )}
      >
        {initials(name, fallback)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
