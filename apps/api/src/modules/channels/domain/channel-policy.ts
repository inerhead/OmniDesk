export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

/** Ver, crear y editar canales, y emitir o rotar sus credenciales: OWNER y ADMIN. */
export function canManageChannels(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export type WebhookUrlCheck =
  { ok: true } | { ok: false; reason: 'invalid' | 'https-required' | 'private-ip' };

export interface WebhookUrlPolicy {
  production: boolean;
  /** `N8N_WEBHOOK_ALLOWED_HOSTS`: admiten `http://` e IP privadas (p. ej. n8n en la red del VPS). */
  allowedHosts: string[];
}

/** IPv4 privada, loopback, link-local o "esta red" (incluye los metadatos de nube 169.254.169.254). */
function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(host: string): boolean {
  const match = IPV4.exec(host);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // IPv4 mapeada: `URL` la normaliza a hex (::ffff:10.0.0.1 → ::ffff:a00:1).
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return isPrivateIpv4(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  // fc00::/7 (únicas locales) y fe80::/10 (link-local).
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

/** IP literal privada (v4 o v6), o `null` si el host no es una IP. */
export function isPrivateIpLiteral(hostname: string): boolean | null {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIpv4(host)) return isPrivateIpv4(host);
  // Un host con ":" solo puede ser IPv6 (URL ya validó su forma).
  if (host.includes(':')) return isPrivateIpv6(host);
  return null;
}

/**
 * `webhookUrl` de un canal (defensa contra SSRF): en producción solo `https://`; nunca una IP literal
 * privada. Los hosts de la lista permitida admiten ambas cosas.
 */
export function checkWebhookUrl(raw: string, policy: WebhookUrlPolicy): WebhookUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'invalid' };
  if (policy.allowedHosts.includes(url.hostname.toLowerCase())) return { ok: true };
  if (policy.production && url.protocol !== 'https:')
    return { ok: false, reason: 'https-required' };
  if (isPrivateIpLiteral(url.hostname)) return { ok: false, reason: 'private-ip' };
  return { ok: true };
}

export const WEBHOOK_URL_MESSAGES: Record<
  Exclude<WebhookUrlCheck, { ok: true }>['reason'],
  string
> = {
  invalid: 'webhookUrl debe ser una URL http(s)',
  'https-required':
    'En producción webhookUrl debe usar https:// (o un host de N8N_WEBHOOK_ALLOWED_HOSTS)',
  'private-ip':
    'webhookUrl no puede apuntar a una IP privada (salvo hosts de N8N_WEBHOOK_ALLOWED_HOSTS)',
};
