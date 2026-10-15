// Fija la contraseña de `omnidesk_app_login` (SPEC 12) con la de DATABASE_APP_PASSWORD. Corre al
// arrancar el API, después de las migraciones (que crean el rol) y con el usuario dueño
// (DATABASE_URL). Es idempotente: repetirlo deja la misma contraseña.
import pg from 'pg';

const ROLE = 'omnidesk_app_login';
const ownerUrl = process.env.DATABASE_URL;
const password = process.env.DATABASE_APP_PASSWORD;

if (!ownerUrl) throw new Error('Falta DATABASE_URL');
if (!password) throw new Error('Falta DATABASE_APP_PASSWORD');

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  // `%L` escapa la contraseña: el DDL no admite parámetros.
  const { rows } = await client.query(
    `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql`,
    [ROLE, password],
  );
  await client.query(rows[0].sql);
  console.log(`Contraseña de ${ROLE} asegurada`);
} finally {
  await client.end();
}
