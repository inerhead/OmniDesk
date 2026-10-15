import { Inject, Injectable } from '@nestjs/common';
import { Client } from 'pg';
import { ENV, type Env } from '../../../shared/config/env';
import type { JobLock, JobLockOutcome } from '../application/ports/job-lock';

/**
 * `pg_try_advisory_lock` sobre una conexión propia: el lock es de sesión y el pool de Prisma no
 * garantiza la misma conexión para tomarlo y soltarlo. Si el proceso muere, la conexión se cierra
 * y PostgreSQL lo suelta solo.
 */
@Injectable()
export class PgJobLock implements JobLock {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async tryRun<T>(name: string, work: () => Promise<T>): Promise<JobLockOutcome<T>> {
    const client = new Client({ connectionString: this.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [name],
      );
      if (!rows[0]?.locked) return { acquired: false };
      try {
        return { acquired: true, result: await work() };
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
      }
    } finally {
      await client.end();
    }
  }
}
