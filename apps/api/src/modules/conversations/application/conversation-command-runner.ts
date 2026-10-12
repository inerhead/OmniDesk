import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from '../../members/application/ports/member.repository';
import { can } from '../domain/conversation-policy';
import { decideTransition, type ConversationCommand } from '../domain/conversation-transitions';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

export type CommandResult =
  | { kind: 'ok' }
  /** La conversación no existe, o el AGENT no puede verla. */
  | { kind: 'not-found' }
  | { kind: 'member-not-found' }
  | { kind: 'forbidden' }
  | { kind: 'rejected'; reason: 'CONTROL_CHANGED' | 'INVALID_STATE' };

export interface CommandInput {
  conversationId: string;
  controlVersion: number;
  command: ConversationCommand;
}

/**
 * Ejecuta un comando sobre una conversación en una sola transacción (docs/arquitectura.md §9):
 * bloquea la fila, valida rol, `controlVersion` y estado, aplica el cambio, escribe el evento
 * (que consume una `sequence`) y encola `conversation.changed` con `reason: 'assignment'`.
 */
@Injectable()
export class ConversationCommandRunner {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  run(actor: ActorContext, input: CommandInput): Promise<CommandResult> {
    return this.tx.run(() => this.execute(actor, input));
  }

  private async execute(actor: ActorContext, input: CommandInput): Promise<CommandResult> {
    const { command } = input;
    const conversation = await this.conversations.findByIdForUpdate(
      actor.tenantId,
      input.conversationId,
    );
    if (!conversation || !can(actor, 'view', conversation)) return { kind: 'not-found' };

    const targetMemberId = command.type === 'assign' ? command.memberId : undefined;
    if (!can(actor, command.type, conversation, targetMemberId)) return { kind: 'forbidden' };

    if (
      command.type === 'assign' &&
      !(await this.members.findById(actor.tenantId, command.memberId))
    ) {
      return { kind: 'member-not-found' };
    }

    if (conversation.controlVersion !== input.controlVersion) {
      return { kind: 'rejected', reason: 'CONTROL_CHANGED' };
    }

    const transition = decideTransition(conversation, command);
    if (!transition.ok) return { kind: 'rejected', reason: transition.reason };

    const now = new Date();
    const updated = await this.conversations.applyTransition(conversation, transition.next);
    await this.conversations.appendEvent(
      updated,
      {
        type: transition.event.type,
        actorMemberId: actor.memberId,
        targetMemberId: transition.event.targetMemberId,
      },
      now,
    );
    await enqueueConversationChanged(
      this.outbox,
      actor.tenantId,
      conversation.id,
      'assignment',
      now,
    );
    return { kind: 'ok' };
  }
}
