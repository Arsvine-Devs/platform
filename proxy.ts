import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'arsvine_admin_session';
const DEVELOPMENT_SESSION_COOKIE = 'arsvine_admin_dev_session';

// Admin API endpoints that legitimately accept unauthenticated requests.
// Everything else under /api/admin/* must carry the session cookie at the
// edge — individual route handlers still re-verify the HMAC signature.
const PUBLIC_ADMIN_API_PATHS = new Set<string>([
  '/api/admin/login',
  '/api/admin/webauthn/authentication/options',
  '/api/admin/webauthn/authentication/verify',
  '/api/admin/dev-login',
]);

function isAdminApi(pathname: string) {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Defense-in-depth: short-circuit obviously unauthenticated calls to the
  // admin API before they reach a route handler. Per-route checks remain the
  // source of truth (they validate the HMAC signature); this just stops new
  // routes from being silently exposed if the author forgets the boilerplate.
  if (isAdminApi(pathname) && !PUBLIC_ADMIN_API_PATHS.has(pathname)) {
    const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value || request.cookies.get(DEVELOPMENT_SESSION_COOKIE)?.value);
    if (!hasSession) {
      return NextResponse.json(
        { ok: false, error: { message: 'Unauthorized' } },
        { status: 401 },
      );
    }
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
