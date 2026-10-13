import { availableCommands, type ConversationSummary, type Member } from '@omnidesk/contracts';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import type { RunCommandInput } from '../api/use-conversation-command';

interface Action {
  key: string;
  label: string;
  input: RunCommandInput;
}

/**
 * Botones del encabezado según `availableCommands` (la misma política del API, que siempre decide).
 * `inline`: en escritorio van en línea; en móvil queda una acción principal y el resto en el menú
 * "⋯". `stacked`: todas en columna, a lo ancho (panel de contacto).
 */
export function ConversationActions({
  conversation,
  actor,
  members,
  pending,
  onRun,
  layout = 'inline',
}: {
  conversation: ConversationSummary;
  actor: Member;
  members: Member[];
  pending: boolean;
  onRun: (input: RunCommandInput) => void;
  layout?: 'inline' | 'stacked';
}) {
  const available = availableCommands(
    { memberId: actor.id, role: actor.role },
    { status: conversation.status, assignedAgentId: conversation.assignedAgent?.id ?? null },
  );
  const { controlVersion } = conversation;

  // Orden de prioridad: la primera es la acción principal en móvil.
  const buttons: Action[] = [];
  if (available.take) {
    buttons.push({
      key: 'take',
      label: 'Tomar',
      input: { command: 'assign', controlVersion, memberId: actor.id },
    });
  }
  if (available.reopen) {
    buttons.push({ key: 'reopen', label: 'Reabrir', input: { command: 'reopen', controlVersion } });
  }
  if (available.release) {
    buttons.push({
      key: 'release',
      label: 'Liberar',
      input: { command: 'release', controlVersion },
    });
  }
  if (available.close) {
    buttons.push({ key: 'close', label: 'Cerrar', input: { command: 'close', controlVersion } });
  }

  const assignees: Action[] = available.assignOther
    ? members
        .filter((member) => member.id !== actor.id && member.id !== conversation.assignedAgent?.id)
        .map((member) => ({
          key: `assign-${member.id}`,
          label: member.displayName,
          input: { command: 'assign', controlVersion, memberId: member.id },
        }))
    : [];

  if (buttons.length === 0 && assignees.length === 0) return null;

  const variantOf = (action: Action) =>
    action.key === 'take' || action.key === 'reopen' ? 'default' : 'outline';

  const assignMenu = (stacked: boolean) =>
    assignees.length > 0 && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            className={cn(stacked && 'w-full')}
          >
            Asignar a…
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {assignees.map((action) => (
            <DropdownMenuItem key={action.key} onSelect={() => onRun(action.input)}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  if (layout === 'stacked') {
    return (
      <div className="flex flex-col gap-2">
        {buttons.map((action) => (
          <Button
            key={action.key}
            size="sm"
            variant={variantOf(action)}
            disabled={pending}
            onClick={() => onRun(action.input)}
          >
            {action.label}
          </Button>
        ))}
        {assignMenu(true)}
      </div>
    );
  }

  const [primary, ...secondary] = buttons;
  return (
    <>
      {/* Escritorio */}
      <div className="hidden items-center gap-2 lg:flex">
        {buttons.map((action) => (
          <Button
            key={action.key}
            size="sm"
            variant={variantOf(action)}
            disabled={pending}
            onClick={() => onRun(action.input)}
          >
            {action.label}
          </Button>
        ))}
        {assignMenu(false)}
      </div>

      {/* Móvil y tablet: acción principal + menú "⋯" con el resto */}
      <div className="flex items-center gap-1 lg:hidden">
        {primary && (
          <Button size="sm" disabled={pending} onClick={() => onRun(primary.input)}>
            {primary.label}
          </Button>
        )}
        {(secondary.length > 0 || assignees.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Más acciones" disabled={pending}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {secondary.map((action) => (
                <DropdownMenuItem key={action.key} onSelect={() => onRun(action.input)}>
                  {action.label}
                </DropdownMenuItem>
              ))}
              {assignees.map((action) => (
                <DropdownMenuItem key={action.key} onSelect={() => onRun(action.input)}>
                  Asignar a {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  );
}
