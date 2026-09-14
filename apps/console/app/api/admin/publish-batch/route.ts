import { NextResponse, type NextRequest } from 'next/server';

import { getSessionFromRequest, verifyCsrf } from '../../../../lib/auth';
import { getClientKey } from '../../../../lib/client-key';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { publishPostBatch } from '../../../../lib/posts';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import type {
  BlogPublishBatchInput,
  BlogPublishResponse,
} from '../../../../lib/admin-api/contracts';
import {
  isDevelopmentBypassSession,
  publishDevelopmentBatch,
} from '../../../../lib/development-preview';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 });
  }

  if (!verifyCsrf(request, session)) {
    return NextResponse.json(
      { ok: false, error: { message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  if (isDevelopmentBypassSession(session)) {
    const body = (await request.json()) as BlogPublishBatchInput;
    const data: BlogPublishResponse = publishDevelopmentBatch(body);
    return NextResponse.json({ ok: true, data });
  }

  const limiter = await enforceRateLimit(`publish-batch:${getClientKey(request)}`, 5, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '批量发布过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as BlogPublishBatchInput;

    const data: BlogPublishResponse = await withSessionWorkspace(session, () =>
      publishPostBatch(body),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: error instanceof Error ? error.message : 'Batch publish failed.' },
      },
      { status: 500 },
    );
  }
}
