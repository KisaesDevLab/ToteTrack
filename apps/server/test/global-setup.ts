import pg from 'pg';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { TEST_DATABASE_URL } from './helpers.js';

/** Creates the test database (if missing) and applies migrations once per run. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, '');
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const handle = createDb(TEST_DATABASE_URL);
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
