import * as shared from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import * as domain from '../domain/conversation-policy';

const roles: domain.MemberRole[] = ['OWNER', 'ADMIN', 'AGENT'];
const actions: domain.PolicyAction[] = ['view', 'assign', 'release', 'close', 'reopen'];
const commands: domain.ConversationCommandName[] = ['assign', 'release', 'close', 'reopen'];
const inboxes: domain.Inbox[] = ['ai', 'mine', 'all', 'closed'];
const assigned = [null, 'laura', 'mateo'];
const statuses = ['OPEN', 'CLOSED'] as const;
const targets = [undefined, 'laura', 'mateo'];

/**
 * La web decide qué botones mostrar con la copia de la política que vive en contracts; el API
 * con la del dominio. Esta prueba recorre todas las combinaciones para que no se separen.
 */
describe('paridad de la política entre el dominio y contracts', () => {
  it('can, commandApplies y canViewInbox dan lo mismo en todas las combinaciones', () => {
    for (const role of roles) {
      const actor = { memberId: 'laura', role };
      for (const inbox of inboxes) {
        expect(shared.canViewInbox(actor, inbox)).toBe(domain.canViewInbox(actor, inbox));
      }
      for (const status of statuses) {
        for (const assignedAgentId of assigned) {
          const conversation = { status, assignedAgentId };
          for (const target of targets) {
            for (const action of actions) {
              expect(shared.can(actor, action, conversation, target)).toBe(
                domain.can(actor, action, conversation, target),
              );
            }
            for (const command of commands) {
              expect(shared.commandApplies(command, conversation, target)).toBe(
                domain.commandApplies(command, conversation, target),
              );
            }
          }
        }
      }
    }
  });
});
