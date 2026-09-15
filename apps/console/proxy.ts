import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = '__Host-console_session';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isControlApi = pathname === '/api/control' || pathname.startsWith('/api/control/');

  if (isControlApi) {
    const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
    if (!hasSession) {
      return NextResponse.json({ ok: false, error: { message: 'Unauthorized' } }, { status: 401 });
    }
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
