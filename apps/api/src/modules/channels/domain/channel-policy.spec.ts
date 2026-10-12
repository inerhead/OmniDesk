import { describe, expect, it } from 'vitest';
import { canManageChannels, checkWebhookUrl, isPrivateIpLiteral } from './channel-policy';

const prod = { production: true, allowedHosts: ['n8n'] };
const dev = { production: false, allowedHosts: [] };

describe('canManageChannels', () => {
  it('OWNER y ADMIN sí; AGENT no', () => {
    expect(canManageChannels('OWNER')).toBe(true);
    expect(canManageChannels('ADMIN')).toBe(true);
    expect(canManageChannels('AGENT')).toBe(false);
  });
});

describe('checkWebhookUrl', () => {
  it('en producción acepta https público', () => {
    expect(checkWebhookUrl('https://n8n.gastromesa.com/webhook/send', prod)).toEqual({ ok: true });
  });

  it('en producción rechaza http salvo hosts permitidos', () => {
    expect(checkWebhookUrl('http://n8n.gastromesa.com/webhook', prod)).toEqual({
      ok: false,
      reason: 'https-required',
    });
    expect(checkWebhookUrl('http://n8n:5678/webhook/x', prod)).toEqual({ ok: true });
  });

  it('rechaza IP literales privadas en cualquier entorno, salvo hosts permitidos', () => {
    expect(checkWebhookUrl('http://10.0.0.5/hook', prod).ok).toBe(false);
    for (const url of [
      'http://10.0.0.5/hook',
      'http://127.0.0.1:5678/hook',
      'http://192.168.1.10/hook',
      'http://172.20.0.3/hook',
      'http://169.254.169.254/latest',
      'http://[::1]/hook',
      'http://[fd00::1]/hook',
      'http://[::ffff:10.0.0.1]/hook',
    ]) {
      expect(checkWebhookUrl(url, dev)).toEqual({ ok: false, reason: 'private-ip' });
    }
    expect(
      checkWebhookUrl('http://127.0.0.1:5678/hook', {
        production: false,
        allowedHosts: ['127.0.0.1'],
      }),
    ).toEqual({
      ok: true,
    });
  });

  it('en desarrollo admite http a hosts por nombre e IP públicas', () => {
    expect(checkWebhookUrl('http://n8n.local:5678/webhook', dev)).toEqual({ ok: true });
    expect(checkWebhookUrl('http://8.8.8.8/hook', dev)).toEqual({ ok: true });
  });

  it('rechaza esquemas que no son http(s) o URLs inválidas', () => {
    expect(checkWebhookUrl('ftp://n8n/x', dev)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkWebhookUrl('no es url', dev)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('isPrivateIpLiteral', () => {
  it('null para nombres de host', () => {
    expect(isPrivateIpLiteral('n8n.example.com')).toBeNull();
    expect(isPrivateIpLiteral('1.1.1.1')).toBe(false);
  });
});
