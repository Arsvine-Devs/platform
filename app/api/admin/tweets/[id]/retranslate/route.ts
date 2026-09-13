import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest, verifyCsrf } from '../../../../../../lib/auth';
import { getClientKey } from '../../../../../../lib/client-key';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';
import { retranslateTweet, StoreError } from '../../../../../../lib/tweets';
import { triggerTweetsRevalidate } from '../../../../../../lib/github';
import { withSessionWorkspace } from '../../../../../../lib/request-auth';
import { isDevelopmentBypassSession, retranslateDevelopmentTweet } from '../../../../../../lib/development-preview';

function toErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof StoreError) {
    return NextResponse.json(
      { ok: false, error: { message: error.message } },
      { status: error.status },
    );
  }

  return NextResponse.json(
    { ok: false, error: { message: error instanceof Error ? error.message : fallbackMessage } },
    { status: 500 },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  if (!verifyCsrf(request, session)) {
    return NextResponse.json(
      { ok: false, error: { message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  if (isDevelopmentBypassSession(session)) {
    const { id } = await context.params;
    const data = retranslateDevelopmentTweet(id);
    return data
      ? NextResponse.json({ ok: true, data: { ...data, revalidated: { revalidated: false, paths: [], error: 'Development preview: remote revalidation skipped.' } } })
      : NextResponse.json({ ok: false, error: { message: 'Tweet not found.' } }, { status: 404 });
  }

  const limiter = await enforceRateLimit(`tweets-retranslate:${getClientKey(request)}`, 10, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '自动翻译过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const { id } = await context.params;
    const { data, revalidated } = await withSessionWorkspace(session, async () => ({ data: await retranslateTweet(id), revalidated: await triggerTweetsRevalidate() }));
    return NextResponse.json({ ok: true, data: { ...data, revalidated } });
  } catch (error) {
    return toErrorResponse(error, 'Failed to retranslate tweet.');
  }
}
