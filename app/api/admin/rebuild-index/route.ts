import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest, verifyCsrf } from '../../../../lib/auth';
import { rebuildBlogIndex } from '../../../../lib/posts';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import type { BlogRebuildData } from '../../../../lib/admin-api/contracts';
import {
  isDevelopmentBypassSession,
  rebuildDevelopmentBlogIndex,
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
    const data: BlogRebuildData = rebuildDevelopmentBlogIndex();
    return NextResponse.json({ ok: true, data });
  }

  try {
    const data: BlogRebuildData = await withSessionWorkspace(session, () => rebuildBlogIndex());
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: error instanceof Error ? error.message : 'Rebuild failed.' },
      },
      { status: 500 },
    );
  }
}
