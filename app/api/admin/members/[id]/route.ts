import { NextResponse, type NextRequest } from 'next/server';
import { setMemberStatus } from '../../../../../lib/accounts';
import { getSessionFromRequest, isOwner, verifyCsrf } from '../../../../../lib/auth';
import {
  isDevelopmentBypassSession,
  setDevelopmentMemberStatus,
} from '../../../../../lib/development-preview';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session))
    return NextResponse.json({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });
  if (!verifyCsrf(request, session))
    return NextResponse.json(
      { ok: false, error: { message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  if (isDevelopmentBypassSession(session)) {
    const { status } = (await request.json()) as { status?: 'active' | 'disabled' };
    const { id } = await context.params;
    if ((status !== 'active' && status !== 'disabled') || !setDevelopmentMemberStatus(id, status))
      return NextResponse.json(
        { ok: false, error: { message: 'Member status is invalid.' } },
        { status: 422 },
      );
    return NextResponse.json({ ok: true });
  }
  try {
    const { status } = (await request.json()) as { status?: 'active' | 'disabled' };
    if (status !== 'active' && status !== 'disabled') throw new Error('无效的账户状态。');
    const { id } = await context.params;
    await setMemberStatus(session.userId, id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { message: error instanceof Error ? error.message : '无法更新成员。' } },
      { status: 422 },
    );
  }
}
