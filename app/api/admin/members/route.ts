import { NextResponse, type NextRequest } from 'next/server';
import { createInvitation, listMembers, listPendingInvitations } from '../../../../lib/accounts';
import { getSessionFromRequest, isOwner, verifyCsrf } from '../../../../lib/auth';
import { privateJson } from '../../../../lib/private-response';
import type { InviteData, MembersData } from '../../../../lib/admin-api/contracts';
import { createDevelopmentInvitation, getDevelopmentMembers, isDevelopmentBypassSession } from '../../../../lib/development-preview';

function forbidden() { return NextResponse.json({ ok: false, error: { message: 'Forbidden' } }, { status: 403 }); }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return forbidden();
  if (isDevelopmentBypassSession(session)) return privateJson({ ok: true, data: getDevelopmentMembers() });
  const [members, invitations] = await Promise.all([listMembers(), listPendingInvitations()]);
  const data: MembersData = {
    members: members.map((member) => ({ ...member, createdAt: member.createdAt.toISOString(), updatedAt: member.updatedAt.toISOString() })),
    invitations: invitations.map((invitation) => ({ id: invitation.id, email: invitation.email, status: 'pending' as const, expiresAt: invitation.expiresAt.toISOString(), createdAt: invitation.createdAt.toISOString() })),
  };
  return privateJson({ ok: true, data });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return forbidden();
  if (!verifyCsrf(request, session)) return NextResponse.json({ ok: false, error: { message: 'Invalid CSRF token.' } }, { status: 403 });
  if (isDevelopmentBypassSession(session)) {
    const { email } = await request.json() as { email?: string };
    const data: InviteData = createDevelopmentInvitation(email ?? '');
    return NextResponse.json({ ok: true, data }, { status: 201 });
  }
  try {
    const { email } = await request.json() as { email?: string };
    const invitation = await createInvitation(session.userId, email ?? '');
    const url = new URL('/activate', request.nextUrl.origin);
    url.searchParams.set('token', invitation.token);
    const data: InviteData = { invitationUrl: url.toString(), expiresAt: invitation.expiresAt.toISOString() };
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return NextResponse.json({ ok: false, error: { message: error instanceof Error ? error.message : '无法创建邀请。' } }, { status: 422 }); }
}
