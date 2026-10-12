import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip } from '@/shared/ui/tooltip';
import { parseThemePref, setThemePref, useThemePref, type ThemePref } from './theme-store';

const OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

/** Menú de tema Claro / Oscuro / Sistema; el icono refleja la preferencia elegida. */
export function ThemeMenu({
  side = 'right',
  className,
}: {
  side?: ComponentProps<typeof DropdownMenuContent>['side'];
  className?: string;
}) {
  const pref = useThemePref();
  const current = OPTIONS.find((option) => option.value === pref) ?? OPTIONS[2]!;
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <Tooltip content={`Tema: ${current.label}`} side={side}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Tema" className={className}>
            <Icon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side={side} align="end">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pref}
          onValueChange={(value) => setThemePref(parseThemePref(value))}
        >
          {OPTIONS.map(({ value, label, icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <OptionIcon aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
