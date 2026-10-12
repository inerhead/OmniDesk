import { Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import { ConversationCommandRunner, type CommandResult } from './conversation-command-runner';

export interface CloseConversationInput {
  conversationId: string;
  controlVersion: number;
}

/** Cierra la conversación conservando el agente asignado. */
@Injectable()
export class CloseConversationUseCase {
  constructor(private readonly runner: ConversationCommandRunner) {}

  execute(actor: ActorContext, input: CloseConversationInput): Promise<CommandResult> {
    return this.runner.run(actor, { ...input, command: { type: 'close' } });
  }
}
