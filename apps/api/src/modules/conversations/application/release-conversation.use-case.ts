import { Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import { ConversationCommandRunner, type CommandResult } from './conversation-command-runner';

export interface ReleaseConversationInput {
  conversationId: string;
  controlVersion: number;
}

/** Devuelve la conversación a la IA. */
@Injectable()
export class ReleaseConversationUseCase {
  constructor(private readonly runner: ConversationCommandRunner) {}

  execute(actor: ActorContext, input: ReleaseConversationInput): Promise<CommandResult> {
    return this.runner.run(actor, { ...input, command: { type: 'release' } });
  }
}
