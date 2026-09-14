import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { betterAuth } from "better-auth";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

type AuthDatabase = Record<string, never>;

const databaseUrl = process.env.AUTH_DATABASE_URL?.trim();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const kysely = pool
  ? new Kysely<AuthDatabase>({ dialect: new PostgresDialect({ pool }) })
  : null;

if (!kysely) {
  // The service can still build and expose liveness locally without credentials.
  // Auth requests remain unavailable until AUTH_DATABASE_URL and BETTER_AUTH_SECRET exist.
  console.warn("[auth] AUTH_DATABASE_URL is not configured");
}

export const auth = betterAuth({
  database: kysely
    ? kyselyAdapter(kysely, { type: "postgres", transaction: true })
    : undefined,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3003",
  secret: process.env.BETTER_AUTH_SECRET ?? "development-only-auth-secret",
  emailAndPassword: { enabled: true },
  trustedOrigins: [
    "http://localhost:3003",
    "https://auth.arsvine.com",
    "https://console.arsvine.com",
  ],
});
