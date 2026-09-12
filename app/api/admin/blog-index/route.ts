import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getBlogIndex } from '../../../../lib/posts';
import { withSessionWorkspace } from '../../../../lib/request-auth';
import { privateJson } from '../../../../lib/private-response';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  try {
    const data = await withSessionWorkspace(session, () => getBlogIndex());
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
