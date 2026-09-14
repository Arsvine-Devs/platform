import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeAuthorizationCode,
  normalizeReturnTo,
  OIDC_STATE_COOKIE,
  openState,
} from '@/lib/oidc';
import {
  applyOidcSessionCookies,
  createOidcSession,
} from '@/lib/oidc-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = openState(request.cookies.get(OIDC_STATE_COOKIE)?.value);
  if (!code || !state || request.nextUrl.searchParams.get('state') !== state.state) {
    return NextResponse.json({ ok: false, error: { message: 'Invalid OIDC callback.' } }, { status: 400 });
  }

  try {
    const tokens = await exchangeAuthorizationCode(code, state);
    const created = await createOidcSession(tokens);
    const response = NextResponse.redirect(new URL(normalizeReturnTo(state.returnTo), request.url));
    applyOidcSessionCookies(response, created.id, created.session.csrf);
    response.cookies.set(OIDC_STATE_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { message: error instanceof Error ? error.message : 'OIDC callback failed.' } },
      { status: 502 },
    );
  }
}
