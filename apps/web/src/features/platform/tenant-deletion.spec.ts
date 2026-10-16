import { describe, expect, it } from 'vitest';
import { ApiCodeError } from '@/shared/api/api-error';
import { confirmsTenantDeletion, deletionErrorMessage, deletionSummary } from './tenant-deletion';

describe('confirmsTenantDeletion', () => {
  it('solo el slug exacto habilita el borrado', () => {
    expect(confirmsTenantDeletion('acme-sas', 'acme-sas')).toBe(true);
    expect(confirmsTenantDeletion('', 'acme-sas')).toBe(false);
    expect(confirmsTenantDeletion('acme', 'acme-sas')).toBe(false);
    expect(confirmsTenantDeletion(' acme-sas', 'acme-sas')).toBe(false);
    expect(confirmsTenantDeletion('ACME-SAS', 'acme-sas')).toBe(false);
  });
});

describe('deletionSummary', () => {
  it('enumera lo que se borra, con plurales', () => {
    expect(
      deletionSummary({
        members: 3,
        accountsToDelete: 2,
        conversations: 120,
        messages: 4310,
        attachments: 57,
      }),
    ).toBe(
      'Se borrarán 3 miembros, 2 cuentas, 120 conversaciones, 4310 mensajes y 57 archivos. No se puede deshacer.',
    );
  });

  it('usa el singular con uno y el plural con cero', () => {
    expect(
      deletionSummary({
        members: 1,
        accountsToDelete: 1,
        conversations: 1,
        messages: 1,
        attachments: 0,
      }),
    ).toBe(
      'Se borrarán 1 miembro, 1 cuenta, 1 conversación, 1 mensaje y 0 archivos. No se puede deshacer.',
    );
  });
});

describe('deletionErrorMessage', () => {
  it('explica cada código del API', () => {
    expect(deletionErrorMessage(new ApiCodeError(409, 'NOT_SUSPENDED'))).toMatch(/suspendida/);
    expect(deletionErrorMessage(new ApiCodeError(409, 'DEMO_TENANT_LOCKED'))).toMatch(/demo/);
    expect(deletionErrorMessage(new ApiCodeError(400, 'CONFIRMATION_MISMATCH'))).toMatch(
      /no coincide/,
    );
    expect(deletionErrorMessage(new ApiCodeError(404))).toMatch(/ya no existe/);
    expect(deletionErrorMessage(new Error('red'))).toMatch(/Inténtalo de nuevo/);
  });
});
