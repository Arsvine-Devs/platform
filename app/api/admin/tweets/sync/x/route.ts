import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest, verifyCsrf } from '../../../../../../lib/auth';
import { getClientKey } from '../../../../../../lib/client-key';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';
import {
  XTimelineSyncError,
  syncXTimelineForUser,
  type XTimelineSyncMode,
} from '../../../../../../lib/x-timeline-sync';
import {
  isDevelopmentBypassSession,
  syncDevelopmentTweets,
} from '../../../../../../lib/development-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session)
    return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 });
  if (!verifyCsrf(request, session)) {
    return NextResponse.json(
      { ok: false, error: { message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  if (isDevelopmentBypassSession(session)) {
    const body = (await request.json().catch(() => ({}))) as { mode?: XTimelineSyncMode };
    return NextResponse.json({
      ok: true,
      data: syncDevelopmentTweets(body.mode === 'backfill' ? 'backfill' : 'recent'),
    });
  }

  const limiter = await enforceRateLimit(`tweets-x-sync:${getClientKey(request)}`, 6, 10 * 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: 'X 同步过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { mode?: XTimelineSyncMode };
    const mode = body.mode === 'backfill' ? 'backfill' : 'recent';
    const result = await syncXTimelineForUser(session.userId, { mode, maxPages: 5 });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof XTimelineSyncError) {
      return NextResponse.json(
        { ok: false, error: { message: error.message } },
        { status: error.status },
      );
    }
    console.error('[api/admin/tweets/sync/x] failed:', error);
    return NextResponse.json(
      { ok: false, error: { message: 'X timeline sync failed.' } },
      { status: 502 },
    );
  }
}
