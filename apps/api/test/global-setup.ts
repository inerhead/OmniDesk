import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { testDatabaseUrl } from './support/test-env';

/** Crea la base `<db>_e2e` si no existe, aplica las migraciones y la vacía. */
export default async function setup(): Promise<void> {
  const testUrl = new URL(testDatabaseUrl());
  const database = testUrl.pathname.slice(1);

  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'ignore',
  });

  const db = new Client({ connectionString: testUrl.toString() });
  await db.connect();
  await db.query(
    'TRUNCATE outbox_events, messages, conversations, contact_identities, contacts, integration_credentials, channels, tenants CASCADE',
  );
  await db.end();
}
