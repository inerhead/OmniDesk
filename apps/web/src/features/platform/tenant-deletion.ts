import type { TenantDeletionPreview } from '@omnidesk/contracts';
import { ApiCodeError } from '@/shared/api/api-error';

/** El slug escrito debe ser exactamente el de la empresa, como lo comprueba el API (SPEC 20). */
export function confirmsTenantDeletion(typed: string, slug: string): boolean {
  return typed === slug;
}

const count = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;

/** "Se borrarán 3 miembros, 1 cuenta, … y 4 archivos. No se puede deshacer." */
export function deletionSummary(preview: TenantDeletionPreview): string {
  const parts = [
    count(preview.members, 'miembro', 'miembros'),
    count(preview.accountsToDelete, 'cuenta', 'cuentas'),
    count(preview.conversations, 'conversación', 'conversaciones'),
    count(preview.messages, 'mensaje', 'mensajes'),
  ];
  const files = count(preview.attachments, 'archivo', 'archivos');
  return `Se borrarán ${parts.join(', ')} y ${files}. No se puede deshacer.`;
}

/** Error del borrado, dentro del diálogo. */
export function deletionErrorMessage(error: unknown): string {
  if (error instanceof ApiCodeError) {
    switch (error.code) {
      case 'CONFIRMATION_MISMATCH':
        return 'El identificador no coincide con el de la empresa.';
      case 'NOT_SUSPENDED':
        return 'Solo se puede borrar una empresa suspendida.';
      case 'DEMO_TENANT_LOCKED':
        return 'La empresa demo no se puede borrar.';
    }
    if (error.status === 404) return 'La empresa ya no existe.';
  }
  return 'No se pudo borrar la empresa. Inténtalo de nuevo.';
}
