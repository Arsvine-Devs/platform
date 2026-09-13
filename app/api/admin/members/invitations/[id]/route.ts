import { NextResponse, type NextRequest } from 'next/server';
import { revokeInvitation } from '../../../../../../lib/accounts';
import { getSessionFromRequest, isOwner, verifyCsrf } from '../../../../../../lib/auth';
import { isDevelopmentBypassSession, revokeDevelopmentInvitation } from '../../../../../../lib/development-preview';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return NextResponse.json({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });
  if (!verifyCsrf(request, session)) return NextResponse.json({ ok: false, error: { message: 'Invalid CSRF token.' } }, { status: 403 });
  if (isDevelopmentBypassSession(session)) {
    const { id } = await params;
    if (!revokeDevelopmentInvitation(id)) return NextResponse.json({ ok: false, error: { message: 'Invitation not found.' } }, { status: 422 });
    return NextResponse.json({ ok: true });
  }
  try {
    const { id } = await params;
    await revokeInvitation(session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : '无法撤销邀请。' } }, { status: 422 });
  }
}
