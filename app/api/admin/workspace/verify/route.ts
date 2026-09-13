import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { withSessionWorkspace } from '../../../../../lib/request-auth';
import { verifyRepositoryConnection } from '../../../../../lib/github';
import { privateJson } from '../../../../../lib/private-response';
import { isDevelopmentBypassSession, verifyDevelopmentRepository } from '../../../../../lib/development-preview';

function unauthorized() {
  return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (isDevelopmentBypassSession(session)) {
    return privateJson({ ok: true, data: verifyDevelopmentRepository() });
  }
  try {
    const repository = await withSessionWorkspace(session, verifyRepositoryConnection);
    return privateJson({ ok: true, data: { repository } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { message: error instanceof Error ? error.message : '无法验证仓库连接。' } },
      { status: 422 },
    );
  }
}
