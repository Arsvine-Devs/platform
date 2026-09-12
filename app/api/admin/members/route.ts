import { NextResponse, type NextRequest } from 'next/server';
import { createInvitation, listMembers, listPendingInvitations } from '../../../../lib/accounts';
import { getSessionFromRequest, isOwner, verifyCsrf } from '../../../../lib/auth';
import { privateJson } from '../../../../lib/private-response';

function forbidden() { return NextResponse.json({ ok: false, error: { message: 'Forbidden' } }, { status: 403 }); }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return forbidden();
  const [members, invitations] = await Promise.all([listMembers(), listPendingInvitations()]);
  return privateJson({ ok: true, data: { members, invitations } });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return forbidden();
  if (!verifyCsrf(request, session)) return NextResponse.json({ ok: false, error: { message: 'Invalid CSRF token.' } }, { status: 403 });
  try {
    const { email } = await request.json() as { email?: string };
    const invitation = await createInvitation(session.userId, email ?? '');
    const url = new URL('/activate', request.nextUrl.origin);
    url.searchParams.set('token', invitation.token);
    return NextResponse.json({ ok: true, data: { invitationUrl: url.toString(), expiresAt: invitation.expiresAt } }, { status: 201 });
  } catch (error) { return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : '无法创建邀请。' } }, { status: 422 }); }
}
