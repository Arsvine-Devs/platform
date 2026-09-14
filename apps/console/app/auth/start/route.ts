import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizationRequest, OIDC_STATE_COOKIE, normalizeReturnTo, sealState } from '@/lib/oidc';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const { state, authorizationUrl } = buildAuthorizationRequest(returnTo);
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OIDC_STATE_COOKIE, sealState(state), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
