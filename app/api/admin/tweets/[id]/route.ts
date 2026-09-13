import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest, verifyCsrf } from '../../../../../lib/auth';
import { getClientKey } from '../../../../../lib/client-key';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { deleteTweet, StoreError, updateTweet } from '../../../../../lib/tweets';
import { triggerTweetsRevalidate } from '../../../../../lib/github';
import { withSessionWorkspace } from '../../../../../lib/request-auth';
import { privateJson } from '../../../../../lib/private-response';
import type { UpdateTweetInput } from '../../../../../lib/tweets-types';
import {
  deleteDevelopmentTweet,
  isDevelopmentBypassSession,
  updateDevelopmentTweet,
} from '../../../../../lib/development-preview';

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

async function requireWriteAccess(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      error: NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 }),
    };
  }

  if (!verifyCsrf(request, session)) {
    return {
      error: NextResponse.json(
        { ok: false, error: { message: 'Invalid CSRF token.' } },
        { status: 403 },
      ),
    };
  }

  if (isDevelopmentBypassSession(session)) return { error: null, session };

  const limiter = await enforceRateLimit(`tweets:${getClientKey(request)}`, 20, 60_000);
  if (!limiter.ok) {
    return {
      error: NextResponse.json(
        { ok: false, error: { message: '操作过于频繁，请稍后再试。' } },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
      ),
    };
  }

  return { error: null, session };
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (access.error) return access.error;

  if (isDevelopmentBypassSession(access.session)) {
    const { id } = await context.params;
    const input = (await request.json()) as UpdateTweetInput;
    if (
      input?.content !== undefined &&
      (typeof input.content !== 'string' || !input.content.trim())
    ) {
      return privateJson(
        { ok: false, error: { message: 'Tweet content cannot be empty.' } },
        { status: 400 },
      );
    }
    const data = updateDevelopmentTweet(id, input);
    return data
      ? NextResponse.json({
          ok: true,
          data: {
            ...data,
            revalidated: {
              revalidated: false,
              paths: [],
              error: 'Development preview: remote revalidation skipped.',
            },
          },
        })
      : NextResponse.json({ ok: false, error: { message: 'Tweet not found.' } }, { status: 404 });
  }

  try {
    const { id } = await context.params;
    const input = (await request.json()) as UpdateTweetInput;
    const { data, revalidated } = await withSessionWorkspace(access.session!, async () => ({
      data: await updateTweet(id, input),
      revalidated: await triggerTweetsRevalidate(),
    }));
    return NextResponse.json({ ok: true, data: { ...data, revalidated } });
  } catch (error) {
    return toErrorResponse(error, 'Failed to update tweet.');
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireWriteAccess(request);
  if (access.error) return access.error;

  if (isDevelopmentBypassSession(access.session)) {
    const { id } = await context.params;
    const data = deleteDevelopmentTweet(id);
    return data
      ? NextResponse.json({
          ok: true,
          data: {
            ...data,
            revalidated: {
              revalidated: false,
              paths: [],
              error: 'Development preview: remote revalidation skipped.',
            },
          },
        })
      : NextResponse.json({ ok: false, error: { message: 'Tweet not found.' } }, { status: 404 });
  }

  try {
    const { id } = await context.params;
    const { data, revalidated } = await withSessionWorkspace(access.session!, async () => ({
      data: await deleteTweet(id),
      revalidated: await triggerTweetsRevalidate(),
    }));
    return NextResponse.json({ ok: true, data: { ...data, revalidated } });
  } catch (error) {
    return toErrorResponse(error, 'Failed to delete tweet.');
  }
}
