import { loadEnv } from '../env.js';
import { createDb } from './index.js';
import { runMigrations } from './migrate.js';

const env = loadEnv();
const handle = createDb(env.DATABASE_URL);
try {
  await runMigrations(handle.db);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
