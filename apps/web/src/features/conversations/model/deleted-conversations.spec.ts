import { describe, expect, it } from 'vitest';
import { isConversationDeleted, markConversationDeleted } from './deleted-conversations';

describe('conversaciones borradas', () => {
  it('recuerda las marcadas y no las demás', () => {
    markConversationDeleted('0199c0de-0000-7000-8000-00000000000a');
    expect(isConversationDeleted('0199c0de-0000-7000-8000-00000000000a')).toBe(true);
    expect(isConversationDeleted('0199c0de-0000-7000-8000-00000000000b')).toBe(false);
  });
});
