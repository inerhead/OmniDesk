import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppEvents, verifyMetaSignature } from './whatsapp-protocol';

describe('Webhook de Meta', () => {
  it('autentica los bytes exactos y rechaza firmas ausentes, malformadas o alteradas', () => {
    const raw = Buffer.from('{ "entry": [] }');
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(verifyMetaSignature(raw, signature, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{}'), signature, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(raw, undefined, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(raw, 'sha256=xx', 'app-secret')).toBe(false);
  });
  it('recorre lotes, aísla el phone_number_id e incluye mensajes y estados', () => {
    const value = (id: string) => ({
      metadata: { phone_number_id: id },
      contacts: [{ wa_id: '573001234567', profile: { name: 'Ana' } }],
      messages: [
        {
          id: `wamid.${id}`,
          from: '573001234567',
          timestamp: '1791800000',
          type: 'text',
          text: { body: 'Hola' },
        },
      ],
      statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1791800001' }],
    });
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            { field: 'messages', value: value('own') },
            { field: 'messages', value: value('other') },
          ],
        },
      ],
    };
    const events = parseWhatsAppEvents(body, 'own');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'inbound',
      externalMessageId: 'wamid.own',
      from: { externalId: '+573001234567', displayName: 'Ana' },
      text: 'Hola',
    });
    expect(events[1]).toMatchObject({
      kind: 'status',
      providerMessageId: 'wamid.out',
      status: 'DELIVERED',
    });
  });
  it('acepta el estado si la hora o el phone_number_id llegan como número', () => {
    const events = parseWhatsAppEvents(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 1322469280958506 },
                  statuses: [
                    {
                      id: 'wamid.out',
                      status: 'delivered',
                      timestamp: 1791857764,
                      biz_opaque_callback_data: '',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      '1322469280958506',
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'status',
        providerMessageId: 'wamid.out',
        status: 'DELIVERED',
      }),
    ]);
    expect(events[0]).not.toHaveProperty('messageId');
  });
  it('lee el estado aunque el contacto no traiga profile, como lo manda Meta', () => {
    const events = parseWhatsAppEvents(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '28766413009634402',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '573001167601',
                    phone_number_id: '1322469280958506',
                  },
                  contacts: [{ wa_id: '573008018173', user_id: 'CO.2045529856001704' }],
                  statuses: [
                    {
                      id: 'wamid.out',
                      status: 'delivered',
                      timestamp: '1791838326',
                      recipient_id: '573008018173',
                      recipient_user_id: 'CO.2045529856001704',
                      pricing: {
                        billable: false,
                        pricing_model: 'PMP',
                        category: 'service',
                        type: 'free_customer_service',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      '1322469280958506',
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'status',
        providerMessageId: 'wamid.out',
        status: 'DELIVERED',
      }),
    ]);
  });
  it('acepta el mensaje entrante que Meta envía, con username y user_id', () => {
    const events = parseWhatsAppEvents(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '28766413009634402',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '573001167601',
                    phone_number_id: '1322469280958506',
                  },
                  contacts: [
                    {
                      profile: { name: 'Gossio', username: 'gossio' },
                      wa_id: '573008018173',
                      user_id: 'CO.2045529856001704',
                    },
                  ],
                  messages: [
                    {
                      from: '573008018173',
                      from_user_id: 'CO.2045529856001704',
                      id: 'wamid.HBgMNTczMDA4MDE4MTczFQIAERgS4M0EzQkVBQjgzMEI5OEQxNTgA',
                      timestamp: '1791754355',
                      text: { body: 'Man' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      '1322469280958506',
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'inbound',
        from: { externalId: '+573008018173', displayName: 'Gossio' },
        text: 'Man',
      }),
    ]);
  });
  it('ignora notificaciones ajenas y tipos sin soporte', () => {
    expect(parseWhatsAppEvents({ object: 'other', entry: [] }, 'own')).toEqual([]);
    expect(
      parseWhatsAppEvents(
        {
          object: 'whatsapp_business_account',
          entry: [
            {
              changes: [
                { value: { metadata: { phone_number_id: 'own' }, messages: [{ type: 'image' }] } },
              ],
            },
          ],
        },
        'own',
      ),
    ).toEqual([]);
  });
});
