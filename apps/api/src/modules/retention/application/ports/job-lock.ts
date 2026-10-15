export type JobLockOutcome<T> = { acquired: true; result: T } | { acquired: false };

/** Exclusión entre instancias del API: un trabajo con el mismo nombre corre una sola vez a la vez. */
export interface JobLock {
  /** Ejecuta `work` si consigue el lock; si otra instancia lo tiene, no hace nada. */
  tryRun<T>(name: string, work: () => Promise<T>): Promise<JobLockOutcome<T>>;
}

export const JOB_LOCK = Symbol('JOB_LOCK');
