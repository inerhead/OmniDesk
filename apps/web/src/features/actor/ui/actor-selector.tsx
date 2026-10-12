import { Avatar } from '@/shared/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip } from '@/shared/ui/tooltip';
import { useCurrentActor } from '../api/use-actor';
import { setActorId } from '../model/actor-store';

const ROLE_LABEL = { OWNER: 'Supervisor', ADMIN: 'Admin', AGENT: 'Agente' } as const;

/** "Actuar como": menú de usuario provisional del modo demo, hasta que haya login (SPEC 07). */
export function ActorSelector({ side = 'right' }: { side?: 'right' | 'top' }) {
  const { actor, members } = useCurrentActor();
  if (members.length === 0) return null;

  const label = actor ? `${actor.displayName} · ${ROLE_LABEL[actor.role]}` : 'Actuar como';
  return (
    <DropdownMenu>
      <Tooltip content={label} side={side}>
        <DropdownMenuTrigger
          aria-label={`Actuar como: ${label}`}
          className="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-[3px]"
        >
          <Avatar
            id={actor?.id ?? 'none'}
            name={actor?.displayName ?? null}
            fallback="?"
            size="sm"
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side={side} align="end">
        <DropdownMenuLabel>Actuar como</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={actor?.id ?? ''} onValueChange={setActorId}>
          {members.map((member) => (
            <DropdownMenuRadioItem key={member.id} value={member.id}>
              <span className="flex flex-col">
                <span>{member.displayName}</span>
                <span className="text-muted-foreground text-xs">{ROLE_LABEL[member.role]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
