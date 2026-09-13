import { NextResponse, type NextRequest } from 'next/server';

import { getSessionFromRequest, isOwner, verifyCsrf } from '@/lib/auth';
import { getClientKey } from '@/lib/client-key';
import { enforceRateLimit } from '@/lib/rate-limit';
import { privateJson } from '@/lib/private-response';
import { applyWebAuthnCeremonyCookie, createRegistrationOptions, getWebAuthnConfig, hashSessionBinding, isRecentWebAuthnSession, normalizeCredentialLabel, WEBAUTHN_CHALLENGE_TTL_MS } from '@/lib/webauthn';
import { createWebAuthnChallenge, getOwnerAccount, listActiveWebAuthnCredentials, toStoredWebAuthnCredential } from '@/lib/webauthn-store';
import { isDevelopmentBypassEnabled, isDevelopmentBypassSession } from '@/lib/development-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isDevelopmentBypassEnabled()) {
    const developmentSession = await getSessionFromRequest(request);
    if (isDevelopmentBypassSession(developmentSession)) return privateJson({ ok: false, error: { code: 'development_bypass', message: 'Use the local preview security-key flow.' } }, { status: 409 });
  }
  const limiter = await enforceRateLimit(`webauthn-registration-options:${getClientKey(request)}`, 12, 10 * 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '请求过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session || !isOwner(session)) return privateJson({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });
  if (!verifyCsrf(request, session)) return privateJson({ ok: false, error: { message: 'Invalid CSRF token.' } }, { status: 403 });

  try {
    const owner = await getOwnerAccount();
    if (!owner || owner.id !== session.userId) return privateJson({ ok: false, error: { message: 'Forbidden' } }, { status: 403 });

    const credentials = await listActiveWebAuthnCredentials(owner.id);
    const firstMigration = owner.authMethod === 'password+totp' && session.amr === 'password+totp';
    const managedReauthentication = owner.authMethod === 'webauthn' && isRecentWebAuthnSession(session);
    if (!firstMigration && !managedReauthentication) {
      return privateJson({ ok: false, error: { code: 'reauth_required', message: '请重新使用安全密钥登录后再管理密钥。' } }, { status: 401 });
    }

    const body = await request.json() as { label?: unknown };
    const label = normalizeCredentialLabel(body.label);
    const config = getWebAuthnConfig();
    const options = await createRegistrationOptions({ id: owner.id, email: owner.email }, credentials.map(toStoredWebAuthnCredential));
    const challenge = await createWebAuthnChallenge({
      userId: owner.id,
      type: 'registration',
      challenge: options.challenge,
      rpId: config.rpId,
      origin: config.origin,
      label,
      sessionBindingHash: hashSessionBinding(session.csrf),
      expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
    });

    const response = privateJson({ ok: true, data: { ceremonyId: challenge.id, options } });
    applyWebAuthnCeremonyCookie(response, challenge.id);
    return response;
  } catch {
    console.error('[admin/webauthn/registration/options] ceremony setup error');
    return privateJson({ ok: false, error: { message: '无法开始安全密钥注册。' } }, { status: 422 });
  }
}
