import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest, verifyCsrf } from '../../../../lib/auth';
import { getClientKey } from '../../../../lib/client-key';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { createTweet, getDashboardData, StoreError } from '../../../../lib/tweets';
import { triggerTweetsRevalidate } from '../../../../lib/github';
import type { CreateTweetInput } from '../../../../lib/tweets-types';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import { privateJson } from '../../../../lib/private-response';

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

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  try {
    const data = await withSessionWorkspace(session, () => getDashboardData());
    return privateJson({ ok: true, data });
  } catch (error) {
    return toErrorResponse(error, 'Failed to load tweets.');
  }
}

export async function POST(request: NextRequest) {
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

  const limiter = await enforceRateLimit(`tweets:${getClientKey(request)}`, 20, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '操作过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const input = (await request.json()) as CreateTweetInput;
    const { data, revalidated } = await withSessionWorkspace(session, async () => {
      const data = await createTweet(input);
      return { data, revalidated: await triggerTweetsRevalidate() };
    });
    return NextResponse.json({ ok: true, data: { ...data, revalidated } }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, 'Failed to create tweet.');
  }
}
