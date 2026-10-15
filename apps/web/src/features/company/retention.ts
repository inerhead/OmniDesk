import type { RetentionDays } from '@omnidesk/contracts';

/** Opción del selector: `RetentionDays` como texto (`'none'` = indefinidamente). */
export type RetentionChoice = 'none' | '90' | '180' | '365';

export const RETENTION_CHOICES: { value: RetentionChoice; label: string }[] = [
  { value: 'none', label: 'Indefinidamente' },
  { value: '90', label: '90 días' },
  { value: '180', label: '180 días' },
  { value: '365', label: '365 días' },
];

export function toRetentionChoice(days: RetentionDays): RetentionChoice {
  return days === null ? 'none' : (String(days) as RetentionChoice);
}

export function fromRetentionChoice(choice: RetentionChoice): RetentionDays {
  return choice === 'none' ? null : (Number(choice) as Exclude<RetentionDays, null>);
}

/** Vista previa antes de guardar: el job corre a las 03:30, hora del servidor. */
export function retentionPreviewNotice(conversations: number): string {
  if (conversations === 0)
    return 'No se borrará ninguna conversación en la próxima ejecución (03:30).';
  if (conversations === 1) return 'Se borrará 1 conversación en la próxima ejecución (03:30).';
  return `Se borrarán ${conversations} conversaciones en la próxima ejecución (03:30).`;
}
