import { NextResponse, type NextRequest } from 'next/server';
import { syncAllConfiguredXWorkspaces } from '../../../../lib/x-timeline-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get('authorization')?.trim();
  return Boolean(expected && provided === `Bearer ${expected}`);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 });
  }

  const results = await syncAllConfiguredXWorkspaces({ mode: 'recent', maxPages: 1 });
  const failed = results.filter((item) => item.error);
  const changed = results.filter((item) => item.result?.changed).length;

  return NextResponse.json(
    {
      ok: failed.length === 0,
      processed: results.length,
      changed,
      failed: failed.length,
      results: results.map((item) => ({
        userId: item.userId,
        ...(item.error
          ? { error: item.error }
          : {
              fetched: item.result?.fetched ?? 0,
              created: item.result?.created ?? 0,
              updated: item.result?.updated ?? 0,
              removed: item.result?.removed ?? 0,
              hasMore: item.result?.hasMore ?? false,
              revalidated: item.result?.revalidated?.revalidated ?? null,
            }),
      })),
    },
    { status: failed.length === 0 ? 200 : 207 },
  );
}
