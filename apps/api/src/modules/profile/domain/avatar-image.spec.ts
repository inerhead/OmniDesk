import { describe, expect, it } from 'vitest';
import { avatarStorageKey } from './avatar-image';

describe('avatarStorageKey', () => {
  it('vive bajo users/, fuera de tenants/', () => {
    expect(avatarStorageKey('u1', 'abc')).toBe('users/u1/avatar-abc');
  });
});
