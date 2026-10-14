import { describe, expect, it } from 'vitest';
import {
  isReplyWindowOpen,
  AssignConversationRequestSchema,
  ConversationCommandRequestSchema,
  ConversationSummarySchema,
  ListConversationsQuerySchema,
  ListMessagesQuerySchema,
  ListTimelineResponseSchema,
  SendAgentMessageRequestSchema,
  SendAgentMessageResponseSchema,
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

describe('ListConversationsQuerySchema q', () => {
  it('es opcional y se recorta', () => {
    expect(ListConversationsQuerySchema.parse({}).q).toBeUndefined();
    expect(ListConversationsQuerySchema.parse({ q: '  jua ' }).q).toBe('jua');
  });

  it('exige entre 2 y 100 caracteres tras recortar', () => {
    expect(ListConversationsQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(ListConversationsQuerySchema.safeParse({ q: ' a ' }).success).toBe(false);
    expect(ListConversationsQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
    expect(ListConversationsQuerySchema.safeParse({ q: '300 123' }).success).toBe(true);
  });
});

describe('isReplyWindowOpen', () => {
  const now = new Date('2026-10-13T20:00:00.000Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('abierta antes de 18 h, cerrada desde las 18 h', () => {
    expect(isReplyWindowOpen(hoursAgo(17.99), now)).toBe(true);
    expect(isReplyWindowOpen(hoursAgo(18), now)).toBe(false);
    expect(isReplyWindowOpen(hoursAgo(30).toISOString(), now)).toBe(false);
  });

  it('sin mensajes del cliente está cerrada', () => {
    expect(isReplyWindowOpen(null, now)).toBe(false);
  });
});

describe('ConversationSummarySchema', () => {
  const summary = {
    id: '0199c0de-0000-7000-8000-000000000001',
    status: 'OPEN',
    aiActive: true,
    contact: { id: '0199c0de-0000-7000-8000-000000000002', displayName: null, externalId: '+57' },
    channel: { id: '0199c0de-0000-7000-8000-000000000003', name: 'WA', type: 'WHATSAPP' },
    assignedAgent: null,
    controlVersion: 0,
    lastMessageAt: '2026-10-12T10:00:00.000Z',
    lastMessagePreview: 'Hola',
    lastInboundAt: '2026-10-12T09:00:00.000Z',
    createdAt: '2026-10-12T09:00:00.000Z',
  };

  it('exige createdAt', () => {
    expect(ConversationSummarySchema.safeParse(summary).success).toBe(true);
    expect(ConversationSummarySchema.safeParse({ ...summary, createdAt: undefined }).success).toBe(
      false,
    );
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

  it('acepta un channelId uuid y lo omite si no viene', () => {
    const channelId = '0199c0de-0000-7000-8000-0000000000aa';
    expect(ListConversationsQuerySchema.parse({}).channelId).toBeUndefined();
    expect(ListConversationsQuerySchema.parse({ channelId }).channelId).toBe(channelId);
    expect(ListConversationsQuerySchema.safeParse({ channelId: 'no' }).success).toBe(false);
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
    sender: null,
    failureReason: null,
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

describe('SendAgentMessageRequestSchema', () => {
  const valid = { text: 'Hola', clientMessageId: '0199c0de-0000-7000-8000-000000000001' };

  it('acepta un texto y un clientMessageId uuid', () => {
    expect(SendAgentMessageRequestSchema.parse(valid)).toEqual(valid);
  });

  it('rechaza texto vacío, de más de 4096 caracteres o un clientMessageId que no es uuid', () => {
    expect(SendAgentMessageRequestSchema.safeParse({ ...valid, text: '' }).success).toBe(false);
    expect(
      SendAgentMessageRequestSchema.safeParse({ ...valid, text: 'a'.repeat(4097) }).success,
    ).toBe(false);
    expect(
      SendAgentMessageRequestSchema.safeParse({ ...valid, text: 'a'.repeat(4096) }).success,
    ).toBe(true);
    expect(
      SendAgentMessageRequestSchema.safeParse({ ...valid, clientMessageId: 'x' }).success,
    ).toBe(false);
  });
});

describe('SendAgentMessageResponseSchema', () => {
  it('lleva el agente remitente y el motivo del fallo', () => {
    const message = {
      id: '0199c0de-0000-7000-8000-000000000001',
      sequence: 3,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      text: 'Hola',
      status: 'PENDING',
      sender: { id: '0199c0de-0000-7000-8000-000000000004', displayName: 'Laura' },
      failureReason: null,
      createdAt: '2026-10-12T10:00:00.000Z',
    };
    expect(SendAgentMessageResponseSchema.parse(message).sender?.displayName).toBe('Laura');
    expect(
      SendAgentMessageResponseSchema.safeParse({ ...message, sender: undefined }).success,
    ).toBe(false);
  });
});
