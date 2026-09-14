import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

function createDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('Missing DATABASE_URL');
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

let db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!db) db = createDb();
  return db;
}
