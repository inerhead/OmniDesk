import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { Button } from './button';

/** Menú desplegable mínimo (se cierra al elegir, al pulsar fuera o con Escape). */
export function Menu({
  label,
  trigger,
  children,
  align = 'end',
}: {
  /** Nombre accesible del botón. */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <Button
        size="sm"
        variant="outline"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            'bg-background absolute top-full z-20 mt-1 flex min-w-44 flex-col rounded-md border p-1 shadow-md',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'hover:bg-accent focus-visible:bg-accent rounded-sm px-3 py-2 text-left text-sm outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
