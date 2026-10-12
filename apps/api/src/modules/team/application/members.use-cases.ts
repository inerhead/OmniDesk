import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from '../../conversations/application/ports/conversation-read-model';
import { ReleaseConversationUseCase } from '../../conversations/application/release-conversation.use-case';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../../identity/application/ports/session.repository';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from '../../members/application/ports/member.repository';
import type { Member } from '../../members/domain/member';
import { canChangeRole, canRemove, leavesNoOwner, type MemberRole } from '../domain/team-policy';

export type MemberCommandResult<T = void> =
  { kind: 'ok'; value: T } | { kind: 'forbidden' } | { kind: 'not-found' } | { kind: 'last-owner' };

/** Cambia el rol de un miembro (solo OWNER). Degradar al último OWNER responde `last-owner`. */
@Injectable()
export class UpdateMemberRoleUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
  ) {}

  execute(
    actor: ActorContext,
    memberId: string,
    role: MemberRole,
  ): Promise<MemberCommandResult<Member>> {
    if (!canChangeRole(actor.role)) return Promise.resolve({ kind: 'forbidden' });
    return this.tx.run(async () => {
      // Bloquea los OWNER antes de mirar: dos degradaciones simultáneas no dejan la empresa sin dueño.
      const owners = await this.members.lockOwners(actor.tenantId);
      const member = await this.members.findById(actor.tenantId, memberId);
      if (!member) return { kind: 'not-found' };
      if (role !== 'OWNER' && leavesNoOwner(owners, member.id)) return { kind: 'last-owner' };
      return {
        kind: 'ok',
        value: await this.members.updateRole(actor.tenantId, memberId, role),
      };
    });
  }
}

/**
 * Quita a un miembro (baja lógica): revoca las sesiones de su usuario en esta empresa y devuelve a la
 * IA sus conversaciones abiertas con el caso de uso `release`, como el actor que lo quita.
 */
@Injectable()
export class RemoveMemberUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CONVERSATION_READ_MODEL) private readonly conversations: ConversationReadModel,
    private readonly release: ReleaseConversationUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(actor: ActorContext, memberId: string): Promise<MemberCommandResult> {
    return this.tx.run(async () => {
      const owners = await this.members.lockOwners(actor.tenantId);
      const member = await this.members.findById(actor.tenantId, memberId);
      if (!member) return { kind: 'not-found' };
      if (!canRemove(actor.role, member.role)) return { kind: 'forbidden' };
      if (leavesNoOwner(owners, member.id)) return { kind: 'last-owner' };

      const now = this.clock.now();
      const { userId } = await this.members.markRemoved(actor.tenantId, member.id, now);
      if (userId) await this.sessions.revokeForUserInTenant(userId, actor.tenantId, now);

      for (const conversation of await this.conversations.listAssignedOpen(
        actor.tenantId,
        member.id,
      )) {
        await this.release.execute(actor, {
          conversationId: conversation.id,
          controlVersion: conversation.controlVersion,
        });
      }
      return { kind: 'ok', value: undefined };
    });
  }
}
