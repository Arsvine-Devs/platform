import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readEnv } from "@arsvine/env";
import { loadProjectEnv } from "@arsvine/env/dotenv";

const { Pool } = pg;

loadProjectEnv();

const databaseUrl = readEnv("CORE_DATABASE_URL");
if (!databaseUrl) throw new Error("CORE_DATABASE_URL is required");

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationRoot = path.resolve(here, "../../../migrations/core");
const migrations = ["0001_core.sql", "0002_published_content.sql"];
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query("BEGIN");
  for (const filename of migrations) {
    await pool.query(
      await readFile(path.join(migrationRoot, filename), "utf8"),
    );
  }
  await pool.query("COMMIT");
  const result = await pool.query(
    "SELECT to_regclass('public.posts') AS posts, to_regclass('public.tweets') AS tweets, to_regclass('public.realm_published_posts') AS published_posts",
  );
  console.log(JSON.stringify({ migrated: true, tables: result.rows[0] }));
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
