import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * Control segmentado. Cada opción se pinta con `renderOption` (un `<Link>`, un `<button>`…) para que
 * el estado pueda vivir en la URL; recibe la clase y si está activa.
 */
function SegmentedControl<T extends string>({
  options,
  value,
  label,
  renderOption,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  /** Nombre accesible del grupo. */
  label: string;
  renderOption: (
    option: SegmentedOption<T>,
    props: { className: string; active: boolean },
  ) => ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      data-slot="segmented-control"
      className={cn(
        'bg-muted text-muted-foreground flex min-w-0 overflow-x-auto rounded-lg p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return renderOption(option, {
          active,
          className: cn(
            'min-w-fit flex-1 rounded-md px-2 py-1 text-center text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            active
              ? 'bg-background text-foreground shadow-xs dark:bg-accent'
              : 'hover:text-foreground',
          ),
        });
      })}
    </nav>
  );
}

export { SegmentedControl };
