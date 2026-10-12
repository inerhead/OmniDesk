import type { Member, MemberRole } from '@omnidesk/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldOff, X } from 'lucide-react';
import { useState } from 'react';
import { useCurrentActor } from '@/features/auth/api/use-current-actor';
import { ApiCodeError } from '@/shared/api/api-error';
import { Avatar } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { deleteInvitation, deleteMember, fetchInvitations, patchMemberRole } from '../api/team-api';
import {
  canChangeRoles,
  canManageTeam,
  canRemoveMember,
  canRevokeInvitation,
} from '../model/team-permissions';
import { InviteDialog } from './invite-dialog';

const ROLE_LABEL: Record<MemberRole, string> = { OWNER: 'Owner', ADMIN: 'Admin', AGENT: 'Agente' };
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

function errorNotice(error: unknown): string {
  if (error instanceof ApiCodeError && error.code === 'LAST_OWNER') {
    return 'La empresa debe tener al menos un Owner.';
  }
  if (error instanceof ApiCodeError && error.status === 403)
    return 'Tu rol no permite esta acción.';
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

/** `/settings/members`: miembros activos, invitaciones pendientes, invitar, cambiar rol y quitar. */
export function MembersPage() {
  const { actor, members, isLoading } = useCurrentActor();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const manager = actor !== null && canManageTeam(actor.role);

  const invitations = useQuery({
    queryKey: ['invitations', actor?.id],
    queryFn: fetchInvitations,
    enabled: manager,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members'] }),
      queryClient.invalidateQueries({ queryKey: ['invitations'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
    ]);
  const onSettled = (_data: unknown, error: Error | null) => {
    setNotice(error ? errorNotice(error) : null);
    return refresh();
  };

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: MemberRole }) => patchMemberRole(id, role),
    onSettled,
  });
  const remove = useMutation({ mutationFn: deleteMember, onSettled });
  const revoke = useMutation({ mutationFn: deleteInvitation, onSettled });
  const pending = changeRole.isPending || remove.isPending || revoke.isPending;

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!actor || !manager) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={ShieldOff}
          title="No tienes acceso"
          description="Solo los Owner y Admin gestionan los miembros de la empresa."
        />
      </div>
    );
  }

  const confirmRemove = (member: Member) => {
    if (
      window.confirm(
        `¿Quitar a ${member.displayName}? Sus conversaciones abiertas vuelven a la IA y se cierra su sesión en esta empresa.`,
      )
    ) {
      remove.mutate(member.id);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Miembros</h1>
            <p className="text-muted-foreground text-sm">
              Quién trabaja en esta empresa y con qué rol.
            </p>
          </div>
          <InviteDialog actorRole={actor.role} />
        </header>

        {notice && (
          <div
            role="status"
            className="bg-warning text-warning-foreground flex items-center justify-between gap-2 rounded-md px-4 py-2 text-sm"
          >
            <span>{notice}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cerrar aviso"
              onClick={() => setNotice(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
        )}

        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {members.map((member) => {
              const isSelf = member.id === actor.id;
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar id={member.id} name={member.displayName} fallback="?" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {member.displayName}
                      {isSelf && <span className="text-muted-foreground font-normal"> (tú)</span>}
                    </span>
                  </div>
                  {canChangeRoles(actor.role) ? (
                    <select
                      aria-label={`Rol de ${member.displayName}`}
                      className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                      value={member.role}
                      disabled={pending}
                      onChange={(event) =>
                        changeRole.mutate({ id: member.id, role: event.target.value as MemberRole })
                      }
                    >
                      {(['OWNER', 'ADMIN', 'AGENT'] as const).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="outline">{ROLE_LABEL[member.role]}</Badge>
                  )}
                  {!isSelf && canRemoveMember(actor.role, member.role) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={pending}
                      onClick={() => confirmRemove(member)}
                    >
                      Quitar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitaciones pendientes</CardTitle>
            <CardDescription>Enlaces sin usar, válidos durante 7 días.</CardDescription>
          </CardHeader>
          <CardContent>
            {invitations.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : !invitations.data?.items.length ? (
              <p className="text-muted-foreground text-sm">No hay invitaciones pendientes.</p>
            ) : (
              <ul className="divide-y">
                {invitations.data.items.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{invitation.email}</span>
                      <span className="text-muted-foreground text-xs">
                        {ROLE_LABEL[invitation.role]} · invitó {invitation.invitedBy.displayName} ·
                        vence el {dateFormat.format(new Date(invitation.expiresAt))}
                      </span>
                    </div>
                    {canRevokeInvitation(actor.role, invitation.role) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => revoke.mutate(invitation.id)}
                      >
                        Revocar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
