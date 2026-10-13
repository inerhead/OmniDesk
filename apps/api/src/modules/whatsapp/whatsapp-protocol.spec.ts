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
