import { NextResponse, type NextRequest } from 'next/server';

import { getSessionFromRequest, isOwner, verifyCsrf, clearAuthCookies } from '@/lib/auth';
import { getClientKey } from '@/lib/client-key';
import { enforceRateLimit } from '@/lib/rate-limit';
import { privateJson } from '@/lib/private-response';
import { clearWebAuthnCeremonyCookie, isRecentWebAuthnSession } from '@/lib/webauthn';
import { getOwnerAccount, revokeWebAuthnCredential } from '@/lib/webauthn-store';
import {
  isDevelopmentBypassEnabled,
  isDevelopmentBypassSession,
  revokeDevelopmentCredential,
} from '@/lib/development-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (isDevelopmentBypassEnabled()) {
    const developmentSession = await getSessionFromRequest(request);
    if (developmentSession && isDevelopmentBypassSession(developmentSession)) {
      if (!verifyCsrf(request, developmentSession))
        return privateJson(
          { ok: false, error: { message: 'Invalid CSRF token.' } },
          { status: 403 },
        );
      const { id } = await params;
      if (!revokeDevelopmentCredential(id))
        return privateJson(
          { ok: false, error: { message: 'At least one security key must remain.' } },
          { status: 422 },
        );
      const response = privateJson({ ok: true });
      clearAuthCookies(response);
      clearWebAuthnCeremonyCookie(response);
      return response;
    }
  }
  const limiter = await enforceRateLimit(
    `webauthn-credentials-revoke:${getClientKey(request)}`,
    12,
    10 * 60_000,
  );
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '操作过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session))
    return privateJson({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });
  if (!verifyCsrf(request, session))
    return privateJson({ ok: false, error: { message: 'Invalid CSRF token.' } }, { status: 403 });
  if (!isRecentWebAuthnSession(session))
    return privateJson(
      {
        ok: false,
        error: { code: 'reauth_required', message: '请重新使用安全密钥登录后再撤销密钥。' },
      },
      { status: 401 },
    );

  try {
    const owner = await getOwnerAccount();
    if (!owner || owner.id !== session.userId)
      return privateJson({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });
    const { id } = await params;
    await revokeWebAuthnCredential(owner.id, id);

    const response = privateJson({ ok: true });
    clearAuthCookies(response);
    clearWebAuthnCeremonyCookie(response);
    return response;
  } catch (error) {
    return privateJson(
      {
        ok: false,
        error: { message: error instanceof Error ? error.message : '无法撤销安全密钥。' },
      },
      { status: 422 },
    );
  }
}
