import { NextResponse, type NextRequest } from 'next/server';

import { getSessionFromRequest, verifyCsrf } from '../../../../lib/auth';
import { buildBlogTranslations } from '../../../../lib/blog-translation';
import { getClientKey } from '../../../../lib/client-key';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import type { BlogTranslateInput, BlogTranslateResponse } from '../../../../lib/admin-api/contracts';
import { isDevelopmentBypassSession, translateDevelopmentBlog } from '../../../../lib/development-preview';

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

  if (isDevelopmentBypassSession(session)) {
    const body = (await request.json()) as BlogTranslateInput;
    const data: BlogTranslateResponse = translateDevelopmentBlog(body);
    return NextResponse.json({ ok: true, data });
  }

  const limiter = await enforceRateLimit(`blog-translate:${getClientKey(request)}`, 6, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '博客自动翻译过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as BlogTranslateInput;

    const data = await withSessionWorkspace(session, () => buildBlogTranslations(body));
    const responseData: BlogTranslateResponse = { variants: data };
    return NextResponse.json({ ok: true, data: responseData });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: error instanceof Error ? error.message : 'Blog translation failed.' },
      },
      { status: 500 },
    );
  }
}
