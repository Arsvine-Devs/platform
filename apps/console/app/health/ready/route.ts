import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

function notReady(reason: string, status = 503) {
  return Response.json(
    { status: 'not_ready', service: 'console', reason },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET() {
  const missing = ['SESSION_SECRET', 'DATABASE_URL'].filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) return notReady(`missing_configuration:${missing.join(',')}`);

  try {
    await getDb().execute(sql`select 1`);
    return Response.json(
      { status: 'ready', service: 'console' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return notReady('database_unavailable');
  }
}
