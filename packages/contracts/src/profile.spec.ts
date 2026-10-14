import { describe, expect, it } from 'vitest';
import { MemberRefSchema } from './conversations';
import { isUploadedAvatarUrl, userAvatarPath } from './profile';

describe('foto de perfil', () => {
  it('versiona la ruta de la foto subida', () => {
    expect(userAvatarPath('0199c0de-0000-7000-8000-000000000002', 1760000000000)).toBe(
      '/api/v1/users/0199c0de-0000-7000-8000-000000000002/avatar?v=1760000000000',
    );
  });

  it('distingue la foto subida de la de Google', () => {
    expect(isUploadedAvatarUrl(userAvatarPath('u1', 1))).toBe(true);
    expect(isUploadedAvatarUrl('https://lh3.googleusercontent.com/a/x')).toBe(false);
    expect(isUploadedAvatarUrl(null)).toBe(false);
  });

  it('acepta payloads antiguos del Outbox sin avatarUrl', () => {
    const ref = { id: '0199c0de-0000-7000-8000-000000000002', displayName: 'Laura' };
    expect(MemberRefSchema.parse(ref)).toEqual({ ...ref, avatarUrl: null });
  });
});
