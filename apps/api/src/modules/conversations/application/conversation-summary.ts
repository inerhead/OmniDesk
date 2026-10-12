import { isAiActive } from '../domain/conversation';
import type { ConversationSummaryView } from './ports/conversation-read-model';

export interface ConversationSummary extends ConversationSummaryView {
  aiActive: boolean;
}

export function toConversationSummary(view: ConversationSummaryView): ConversationSummary {
  return {
    ...view,
    aiActive: isAiActive({ status: view.status, assignedAgentId: view.assignedAgent?.id ?? null }),
  };
}
