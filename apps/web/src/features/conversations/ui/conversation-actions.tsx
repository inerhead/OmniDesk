import { availableCommands, type ConversationSummary, type Member } from '@omnidesk/contracts';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Menu, MenuItem } from '@/shared/ui/menu';
import type { RunCommandInput } from '../api/use-conversation-command';

interface Action {
  key: string;
  label: string;
  input: RunCommandInput;
}

/**
 * Botones del encabezado según `availableCommands` (la misma política del API, que siempre decide).
 * En escritorio van en línea; en móvil queda una acción principal y el resto en el menú "⋯".
 */
export function ConversationActions({
  conversation,
  actor,
  members,
  pending,
  onRun,
}: {
  conversation: ConversationSummary;
  actor: Member;
  members: Member[];
  pending: boolean;
  onRun: (input: RunCommandInput) => void;
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
      label: 'Liberar a IA',
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

  const [primary, ...secondary] = buttons;
  return (
    <>
      {/* Escritorio */}
      <div className="hidden items-center gap-2 md:flex">
        {buttons.map((action) => (
          <Button
            key={action.key}
            size="sm"
            variant={action.key === 'take' || action.key === 'reopen' ? 'default' : 'outline'}
            disabled={pending}
            onClick={() => onRun(action.input)}
          >
            {action.label}
          </Button>
        ))}
        {assignees.length > 0 && (
          <Menu label="Asignar a…" trigger="Asignar a…">
            {assignees.map((action) => (
              <MenuItem key={action.key} disabled={pending} onClick={() => onRun(action.input)}>
                {action.label}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>

      {/* Móvil: acción principal + menú "⋯" con el resto */}
      <div className="flex items-center gap-1 md:hidden">
        {primary && (
          <Button size="sm" disabled={pending} onClick={() => onRun(primary.input)}>
            {primary.label}
          </Button>
        )}
        {(secondary.length > 0 || assignees.length > 0) && (
          <Menu label="Más acciones" trigger={<MoreHorizontal aria-hidden />}>
            {secondary.map((action) => (
              <MenuItem key={action.key} disabled={pending} onClick={() => onRun(action.input)}>
                {action.label}
              </MenuItem>
            ))}
            {assignees.map((action) => (
              <MenuItem key={action.key} disabled={pending} onClick={() => onRun(action.input)}>
                Asignar a {action.label}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
    </>
  );
}
