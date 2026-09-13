import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getBlogIndex } from '../../../../lib/posts';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import { privateJson } from '../../../../lib/private-response';
import type { BlogIndexData } from '../../../../lib/admin-api/contracts';
import { getDevelopmentBlogIndex, isDevelopmentBypassSession } from '../../../../lib/development-preview';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }
  if (isDevelopmentBypassSession(session)) return privateJson({ ok: true, data: getDevelopmentBlogIndex() });

  try {
    const data: BlogIndexData = await withSessionWorkspace(session, () => getBlogIndex());
    return privateJson({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: error instanceof Error ? error.message : 'Failed to load blog index.' },
      },
      { status: 500 },
    );
  }
}
