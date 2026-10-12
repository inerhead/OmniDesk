import type { MemberRole } from '@omnidesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiCodeError } from '@/shared/api/api-error';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { postInvitation } from '../api/team-api';
import { invitableRoles } from '../model/team-permissions';

const ROLE_LABEL = { ADMIN: 'Admin', AGENT: 'Agente' } as const;
const COPIED_MS = 1500;

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={url}
        aria-label="Enlace de invitación"
        onFocus={(e) => e.target.select()}
      />
      <Button
        type="button"
        variant="outline"
        aria-live="polite"
        onClick={() =>
          void navigator.clipboard.writeText(url).then(
            () => setCopied(true),
            () => undefined,
          )
        }
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  );
}

/** "Invitar": crea un enlace de un solo uso (7 días) ligado al email y lo muestra para copiarlo. */
export function InviteDialog({ actorRole }: { actorRole: MemberRole }) {
  const roles = invitableRoles(actorRole);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'AGENT'>('AGENT');

  const invite = useMutation({
    mutationFn: postInvitation,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setEmail('');
      setRole('AGENT');
      invite.reset();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate({ email: email.trim(), role });
  };

  const errorText =
    invite.error instanceof ApiCodeError && invite.error.code === 'ALREADY_MEMBER'
      ? 'Esa persona ya es miembro de la empresa.'
      : invite.error instanceof ApiCodeError && invite.error.status === 400
        ? 'Revisa el email.'
        : 'No se pudo crear la invitación.';

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={roles.length === 0}>
          <UserPlus aria-hidden />
          Invitar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Invitar a la empresa</DialogTitle>
        <DialogDescription>
          Comparte el enlace con la persona invitada. Vale 7 días, un solo uso y solo para su email
          de Google.
        </DialogDescription>
        {invite.data ? (
          <div className="flex flex-col gap-3">
            <CopyLink url={invite.data.url} />
            <Button variant="outline" onClick={() => reset(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <Input
                type="email"
                required
                autoFocus
                value={email}
                placeholder="persona@empresa.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Rol
              <select
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                value={role}
                onChange={(event) => setRole(event.target.value as 'ADMIN' | 'AGENT')}
              >
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            {invite.isError && (
              <p role="alert" className="text-destructive text-sm">
                {errorText}
              </p>
            )}
            <Button type="submit" disabled={invite.isPending || !email.trim()}>
              Crear enlace
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
