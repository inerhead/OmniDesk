import { describe, expect, it } from 'vitest';
import { ListConversationsQuerySchema, ListMessagesQuerySchema } from './conversations';

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

describe('ListMessagesQuerySchema', () => {
  it('aplica limit 50 por defecto', () => {
    expect(ListMessagesQuerySchema.parse({}).limit).toBe(50);
  });

  it('rechaza limit fuera de rango y before no positivo', () => {
    expect(ListMessagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListMessagesQuerySchema.safeParse({ before: '0' }).success).toBe(false);
  });
});
