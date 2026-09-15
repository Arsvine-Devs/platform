import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.CORE_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CORE_DATABASE_URL is required");

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../migrations/core/0001_core.sql",
);
const migration = await readFile(migrationPath, "utf8");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query("BEGIN");
  await pool.query(migration);
  await pool.query("COMMIT");
  const result = await pool.query(
    "SELECT to_regclass('public.posts') AS posts, to_regclass('public.tweets') AS tweets, to_regclass('public.publications') AS publications",
  );
  console.log(JSON.stringify({ migrated: true, tables: result.rows[0] }));
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
