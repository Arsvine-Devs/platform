import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeAuthorizationCode,
  normalizeReturnTo,
  OIDC_STATE_COOKIE,
  openState,
} from '@/lib/oidc';
import { applyOidcSessionCookies, createOidcSession } from '@/lib/oidc-session';

export const dynamic = 'force-dynamic';

function redirectError(request: NextRequest, reason: string) {
  const url = new URL('/auth/error', request.url);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const stateCookie = request.cookies.get(OIDC_STATE_COOKIE)?.value;
  const state = openState(stateCookie);
  const stateQuery = request.nextUrl.searchParams.get('state');
  const stateMatches = Boolean(state && stateQuery === state.state);
  if (!code || !state || !stateMatches) {
    console.warn('[oidc/callback] invalid callback state', {
      hasCode: Boolean(code),
      hasStateCookie: Boolean(stateCookie),
      hasDecodedState: Boolean(state),
      stateMatches,
    });
    return redirectError(request, 'invalid_callback');
  }

  try {
    console.info('[oidc/callback] exchanging authorization code');
    const tokens = await exchangeAuthorizationCode(code, state);
    console.info('[oidc/callback] authorization code exchanged', { role: tokens.role });
    const created = await createOidcSession(tokens);
    console.info('[oidc/callback] console session created', { role: created.session.role });
    const response = NextResponse.redirect(new URL(normalizeReturnTo(state.returnTo), request.url));
    applyOidcSessionCookies(response, created.id, created.session.csrf);
    response.cookies.set(OIDC_STATE_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error('[oidc/callback] failed', {
      message: error instanceof Error ? error.message : 'unknown callback error',
    });
    const message = error instanceof Error ? error.message : 'OIDC callback failed.';
    const reason =
      message === 'OIDC identity claims are incomplete.'
        ? 'identity_claims_incomplete'
        : 'oidc_callback_failed';
    return redirectError(request, reason);
  }
}
