import { getMigrations } from "better-auth/db/migration";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.AUTH_MIGRATION_TOKEN?.trim();
  const supplied = request.headers.get("x-auth-migration-token")?.trim();
  if (!expected || !supplied || supplied !== expected) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const plan = await getMigrations(auth.options, { throwOnUnsafe: true });
  await plan.runMigrations();
  return Response.json({
    status: "migrated",
    created: plan.toBeCreated.map((table) => table.table),
    added: plan.toBeAdded.map((table) => table.table),
    indexes: plan.toBeAddedIndexes.map((index) => index.name),
  });
}
