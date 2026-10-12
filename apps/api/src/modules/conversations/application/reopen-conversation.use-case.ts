import { Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import { ConversationCommandRunner, type CommandResult } from './conversation-command-runner';

export interface ReopenConversationInput {
  conversationId: string;
  controlVersion: number;
}

/** Reabre una conversación cerrada y la devuelve a la IA. */
@Injectable()
export class ReopenConversationUseCase {
  constructor(private readonly runner: ConversationCommandRunner) {}

  execute(actor: ActorContext, input: ReopenConversationInput): Promise<CommandResult> {
    return this.runner.run(actor, { ...input, command: { type: 'reopen' } });
  }
}
