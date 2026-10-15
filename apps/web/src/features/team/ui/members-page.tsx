import type { Member, MemberRole } from '@omnidesk/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldOff, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useCurrentActor } from '@/features/auth/api/use-current-actor';
import { ApiCodeError } from '@/shared/api/api-error';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { Input } from '@/shared/ui/input';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { Skeleton } from '@/shared/ui/skeleton';
import { deleteInvitation, deleteMember, fetchInvitations, patchMemberRole } from '../api/team-api';
import { filterMembers } from '../model/member-search';
import {
  canChangeRoles,
  canManageTeam,
  canRemoveMember,
  canRevokeInvitation,
} from '../model/team-permissions';
import { InvitationRow } from './invitation-row';
import { InviteDialog } from './invite-dialog';
import { MemberRow } from './member-row';

type Tab = 'members' | 'invitations';

function errorNotice(error: unknown): string {
  if (error instanceof ApiCodeError && error.code === 'LAST_OWNER') {
    return 'La empresa debe tener al menos un Owner.';
  }
  if (error instanceof ApiCodeError && error.status === 403)
    return 'Tu rol no permite esta acción.';
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

/**
 * `/settings/members`: pestañas Miembros e Invitaciones (la activa en `?tab=`), buscador por nombre o
 * email, y filas alineadas con rol y acciones (SPEC 17).
 */
export function MembersPage() {
  const { actor, members, isLoading } = useCurrentActor();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'invitations' ? 'invitations' : 'members';
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-48 w-full" />
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

  const pendingInvitations = invitations.data?.items ?? [];
  const visibleMembers = filterMembers(members, query);
  const tabs: { value: Tab; label: string; count: number | undefined }[] = [
    { value: 'members', label: 'Miembros', count: members.length },
    { value: 'invitations', label: 'Invitaciones', count: invitations.data?.items.length },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 md:px-8 md:py-10">
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SegmentedControl
            label="Miembros e invitaciones"
            value={tab}
            options={tabs}
            className="sm:w-80"
            renderOption={(option, { className, active }) => {
              const count = tabs.find((item) => item.value === option.value)?.count;
              return (
                <Link
                  key={option.value}
                  to={{
                    pathname,
                    search: option.value === 'invitations' ? '?tab=invitations' : '',
                  }}
                  replace
                  aria-current={active ? 'page' : undefined}
                  className={cn(className, 'inline-flex items-center justify-center gap-1.5')}
                >
                  {option.label}
                  {count !== undefined && (
                    <span className="text-muted-foreground text-xs tabular-nums">({count})</span>
                  )}
                </Link>
              );
            }}
          />
          {tab === 'members' && (
            <label className="relative flex-1">
              <span className="sr-only">Buscar por nombre o email</span>
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              />
              <Input
                id="members-search"
                type="search"
                value={query}
                placeholder="Buscar por nombre o email"
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
        </div>

        {tab === 'members' ? (
          <Card className="gap-0 py-0">
            {visibleMembers.length === 0 ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                Nadie coincide con «{query.trim()}».
              </p>
            ) : (
              <ul className="divide-y">
                {visibleMembers.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isSelf={member.id === actor.id}
                    canChangeRole={canChangeRoles(actor.role)}
                    canRemove={member.id !== actor.id && canRemoveMember(actor.role, member.role)}
                    pending={pending}
                    onChangeRole={(role) => changeRole.mutate({ id: member.id, role })}
                    onRemove={() => setRemoving(member)}
                  />
                ))}
              </ul>
            )}
          </Card>
        ) : invitations.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : pendingInvitations.length === 0 ? (
          <Card className="py-0">
            <EmptyState
              title="No hay invitaciones pendientes"
              description="Los enlaces de invitación valen 7 días y se usan una sola vez."
              action={<InviteDialog actorRole={actor.role} />}
            />
          </Card>
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {pendingInvitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  canRevoke={canRevokeInvitation(actor.role, invitation.role)}
                  pending={pending}
                  onRevoke={() => revoke.mutate(invitation.id)}
                />
              ))}
            </ul>
          </Card>
        )}

        <ConfirmDialog
          open={removing !== null}
          title={removing ? `Quitar a ${removing.displayName}` : 'Quitar miembro'}
          description="Sus conversaciones abiertas vuelven a la IA y se cierra su sesión en esta empresa."
          confirmLabel="Quitar"
          tone="destructive"
          pending={remove.isPending}
          onConfirm={() => {
            if (!removing) return;
            remove.mutate(removing.id);
            setRemoving(null);
          }}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        />
      </section>
    </div>
  );
}
