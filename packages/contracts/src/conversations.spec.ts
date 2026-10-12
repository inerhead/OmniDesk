import { describe, expect, it } from 'vitest';
import {
  AssignConversationRequestSchema,
  ConversationCommandRequestSchema,
  ListConversationsQuerySchema,
  ListMessagesQuerySchema,
  ListTimelineResponseSchema,
  TimelineItemSchema,
} from './conversations';

describe('ListConversationsQuerySchema', () => {
  it('aplica limit 30 por defecto y convierte strings de query', () => {
    expect(ListConversationsQuerySchema.parse({}).limit).toBe(30);
    expect(ListConversationsQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it('rechaza limit fuera de rango', () => {
    expect(ListConversationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListConversationsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('ListConversationsQuerySchema inbox', () => {
  it("usa la bandeja 'ai' por defecto", () => {
    expect(ListConversationsQuerySchema.parse({}).inbox).toBe('ai');
  });

  it.each(['ai', 'mine', 'all', 'closed'])('acepta la bandeja %s', (inbox) => {
    expect(ListConversationsQuerySchema.parse({ inbox }).inbox).toBe(inbox);
  });

  it('rechaza una bandeja desconocida', () => {
    expect(ListConversationsQuerySchema.safeParse({ inbox: 'otra' }).success).toBe(false);
  });
});

describe('comandos de conversación', () => {
  const memberId = '0199c0de-0000-7000-8000-000000000002';

  it('assign exige un memberId uuid y un controlVersion entero >= 0', () => {
    expect(AssignConversationRequestSchema.safeParse({ memberId, controlVersion: 0 }).success).toBe(
      true,
    );
    expect(
      AssignConversationRequestSchema.safeParse({ memberId: 'laura', controlVersion: 0 }).success,
    ).toBe(false);
    expect(AssignConversationRequestSchema.safeParse({ memberId }).success).toBe(false);
    expect(
      AssignConversationRequestSchema.safeParse({ memberId, controlVersion: -1 }).success,
    ).toBe(false);
  });

  it('release, close y reopen exigen controlVersion', () => {
    expect(ConversationCommandRequestSchema.safeParse({ controlVersion: 3 }).success).toBe(true);
    expect(ConversationCommandRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('TimelineItemSchema', () => {
  const message = {
    kind: 'message',
    id: '0199c0de-0000-7000-8000-000000000001',
    sequence: 1,
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    text: 'Hola',
    status: 'RECEIVED',
    createdAt: '2026-10-12T10:00:00.000Z',
  };
  const event = {
    kind: 'event',
    id: '0199c0de-0000-7000-8000-000000000003',
    sequence: 2,
    type: 'ASSIGNED',
    actor: { id: '0199c0de-0000-7000-8000-000000000004', displayName: 'Sup. Demo' },
    target: { id: '0199c0de-0000-7000-8000-000000000005', displayName: 'Laura' },
    createdAt: '2026-10-12T10:01:00.000Z',
  };

  it('distingue mensajes y eventos por kind', () => {
    expect(TimelineItemSchema.parse(message).kind).toBe('message');
    expect(TimelineItemSchema.parse(event).kind).toBe('event');
  });

  it('acepta un evento del sistema sin actor ni target', () => {
    expect(
      TimelineItemSchema.safeParse({ ...event, type: 'REOPENED', actor: null, target: null })
        .success,
    ).toBe(true);
  });

  it('rechaza un kind desconocido y un tipo de evento desconocido', () => {
    expect(TimelineItemSchema.safeParse({ ...message, kind: 'otro' }).success).toBe(false);
    expect(TimelineItemSchema.safeParse({ ...event, type: 'DELETED' }).success).toBe(false);
  });

  it('valida la respuesta con items intercalados', () => {
    expect(
      ListTimelineResponseSchema.safeParse({ items: [message, event], prevCursor: null }).success,
    ).toBe(true);
  });
});

describe('ListMessagesQuerySchema', () => {
  it('aplica limit 50 por defecto', () => {
    expect(ListMessagesQuerySchema.parse({}).limit).toBe(50);
  });

  it('rechaza limit fuera de rango y before no positivo', () => {
    expect(ListMessagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListMessagesQuerySchema.safeParse({ before: '0' }).success).toBe(false);
  });
});
