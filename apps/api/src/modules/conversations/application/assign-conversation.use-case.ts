import { Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import { ConversationCommandRunner, type CommandResult } from './conversation-command-runner';

export interface AssignConversationInput {
  conversationId: string;
  memberId: string;
  controlVersion: number;
}

/** Asigna (o reasigna) la conversación a un miembro. "Tomar" es asignarse a uno mismo. */
@Injectable()
export class AssignConversationUseCase {
  constructor(private readonly runner: ConversationCommandRunner) {}

  execute(actor: ActorContext, input: AssignConversationInput): Promise<CommandResult> {
    return this.runner.run(actor, {
      conversationId: input.conversationId,
      controlVersion: input.controlVersion,
      command: { type: 'assign', memberId: input.memberId },
    });
  }
}
