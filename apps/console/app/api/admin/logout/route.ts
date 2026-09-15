import { NextResponse, type NextRequest } from 'next/server';
import { clearAuthCookies, getSessionFromRequest, verifyCsrf } from '../../../../lib/auth';
import { deleteOidcSession, oidcSessionIdFromRequest } from '../../../../lib/oidc-session';
import { getClientKey } from '../../../../lib/client-key';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { buildLogoutUrl } from '../../../../lib/oidc';

export async function POST(request: NextRequest) {
  const limiter = await enforceRateLimit(`logout:${getClientKey(request)}`, 30, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '操作过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  // Logout is a state-changing request that mutates a cookie owned by the
  // user agent — without CSRF protection, a malicious page could quietly
  // sign the admin out. We require both a valid session and a matching CSRF
  // token, mirroring the rest of the admin write surface.
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

  let authLogoutUrl: string | null = null;
  try {
    authLogoutUrl = buildLogoutUrl(session.idToken);
  } catch (error) {
    console.error('[admin/logout] Auth RP-initiated logout is not configured:', error);
  }
  if (session.authSource === 'oidc') await deleteOidcSession(oidcSessionIdFromRequest(request));
  const response = NextResponse.json({ ok: true, data: { authLogoutUrl } });
  clearAuthCookies(response);
  return response;
}
