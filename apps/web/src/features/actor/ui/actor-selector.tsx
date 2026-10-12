import { useCurrentActor } from '../api/use-actor';
import { setActorId } from '../model/actor-store';

const ROLE_LABEL = { OWNER: 'Supervisor', ADMIN: 'Admin', AGENT: 'Agente' } as const;

/** "Actuar como": solo existe en modo demo, hasta que haya login. */
export function ActorSelector() {
  const { actor, members } = useCurrentActor();
  if (members.length === 0) return null;

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground hidden sm:inline">Actuar como</span>
      <select
        aria-label="Actuar como"
        className="bg-background h-8 max-w-36 rounded-md border px-2 text-sm"
        value={actor?.id ?? ''}
        onChange={(event) => setActorId(event.target.value)}
      >
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.displayName} · {ROLE_LABEL[member.role]}
          </option>
        ))}
      </select>
    </label>
  );
}
