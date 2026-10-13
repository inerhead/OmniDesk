import { describe, expect, it } from 'vitest';
import { channelBadges } from './channel-selection';

const channel = (id: string, name: string) => ({ id, name });

describe('channelBadges', () => {
  it('usa las iniciales del nombre', () => {
    const badges = channelBadges([channel('a', 'WhatsApp Demo'), channel('b', 'Gastromesa')]);
    expect(badges.get('a')).toBe('WD');
    expect(badges.get('b')).toBe('GA');
  });

  it('si se repiten, usa la primera y la última palabra', () => {
    const badges = channelBadges([
      channel('a', 'Gastromesa Oficial Centro'),
      channel('b', 'Gastromesa Oficial Norte'),
      channel('c', 'WhatsApp Demo'),
    ]);
    expect(badges.get('a')).toBe('GC');
    expect(badges.get('b')).toBe('GN');
    expect(badges.get('c')).toBe('WD');
  });

  it('si aún se repiten, numera por orden', () => {
    const badges = channelBadges([
      channel('a', 'Gossio'),
      channel('b', 'WhatsApp Demo'),
      channel('c', 'Gozo'),
    ]);
    expect(badges.get('a')).toBe('G1');
    expect(badges.get('b')).toBe('WD');
    expect(badges.get('c')).toBe('G2');
  });
});
