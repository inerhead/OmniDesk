import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { apiBase } from '@/shared/config/env';
import { avatarColor, avatarSrc, initials } from '@/shared/lib/avatar';
import { cn } from '@/shared/lib/utils';
import { AVATAR_COLOR_CLASS } from './avatar-colors';

const SIZE_CLASS = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-20 text-2xl',
} as const;

/**
 * Marca de una empresa (SPEC 16): su logo cuadrado o, sin logo (o mientras carga), sus iniciales con
 * el color estable de su id.
 */
export function TenantMark({
  id,
  name,
  logoUrl,
  size = 'sm',
  className,
}: {
  id: string;
  name: string;
  logoUrl: string | null | undefined;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const src = avatarSrc(logoUrl, apiBase);
  return (
    <AvatarPrimitive.Root
      data-slot="tenant-mark"
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-lg select-none',
        SIZE_CLASS[size],
        className,
      )}
    >
      {src && (
        <AvatarPrimitive.Image src={src} alt="" className="aspect-square size-full object-cover" />
      )}
      <AvatarPrimitive.Fallback
        aria-hidden
        className={cn(
          'flex size-full items-center justify-center font-semibold',
          AVATAR_COLOR_CLASS[avatarColor(id)],
        )}
      >
        {initials(name, '?')}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
