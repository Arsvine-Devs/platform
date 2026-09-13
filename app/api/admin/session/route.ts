import { NextResponse, type NextRequest } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { getClientKey } from '../../../../lib/client-key';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { privateJson } from '../../../../lib/private-response';
import type { SessionData } from '../../../../lib/admin-api/contracts';

export async function GET(request: NextRequest) {
  // Lightweight read endpoint, but it's a useful probe for both session
  // enumeration and DoS. Cap it at a generous rate per client.
  const limiter = await enforceRateLimit(`session:${getClientKey(request)}`, 60, 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '请求过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const data: SessionData = {
    userId: session.userId,
    email: session.email,
    role: session.role,
    exp: session.exp,
    authAt: session.authAt,
    csrf: session.csrf,
    amr: session.amr,
    developmentBypass: Boolean(session.developmentBypass),
  };
  return privateJson({
    ok: true,
    data,
  });
}
