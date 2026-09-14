import { NextResponse, type NextRequest } from 'next/server';

import { getClientKey } from '@/lib/client-key';
import { enforceRateLimit } from '@/lib/rate-limit';
import { privateJson } from '@/lib/private-response';
import {
  applyWebAuthnCeremonyCookie,
  createAuthenticationOptions,
  getWebAuthnConfig,
  WEBAUTHN_CHALLENGE_TTL_MS,
} from '@/lib/webauthn';
import {
  createWebAuthnChallenge,
  getOwnerAccount,
  listActiveWebAuthnCredentials,
  toStoredWebAuthnCredential,
} from '@/lib/webauthn-store';
import { isDevelopmentBypassEnabled } from '@/lib/development-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC_ERROR = '安全密钥登录暂不可用，请稍后重试。';

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return privateJson(
      { ok: false, error: { code: 'LEGACY_LOGIN_DISABLED', message: 'Use Auth OIDC sign-in.' } },
      { status: 410 },
    );
  }
  if (isDevelopmentBypassEnabled())
    return privateJson(
      {
        ok: false,
        error: { code: 'development_bypass', message: 'Use the local preview sign-in.' },
      },
      { status: 409 },
    );
  const limiter = await enforceRateLimit(
    `webauthn-auth-options:${getClientKey(request)}`,
    12,
    10 * 60_000,
  );
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '请求过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    // Public ceremony endpoints must be read-only until the Owner has been
    // initialized by the legacy migration login.
    const owner = await getOwnerAccount();
    if (!owner) {
      return privateJson(
        {
          ok: false,
          error: { code: 'setup_required', message: '请先使用现有 Owner 凭据完成安全密钥设置。' },
        },
        { status: 409 },
      );
    }
    const credentials = await listActiveWebAuthnCredentials(owner.id);
    if (owner.status !== 'active' || owner.authMethod !== 'webauthn' || credentials.length === 0) {
      return privateJson(
        {
          ok: false,
          error: { code: 'setup_required', message: '请先使用现有 Owner 凭据完成安全密钥设置。' },
        },
        { status: 409 },
      );
    }

    const config = getWebAuthnConfig();
    const options = await createAuthenticationOptions(credentials.map(toStoredWebAuthnCredential));
    const challenge = await createWebAuthnChallenge({
      userId: owner.id,
      type: 'authentication',
      challenge: options.challenge,
      rpId: config.rpId,
      origin: config.origin,
      expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
    });

    const response = privateJson({ ok: true, data: { ceremonyId: challenge.id, options } });
    applyWebAuthnCeremonyCookie(response, challenge.id);
    return response;
  } catch {
    console.error('[admin/webauthn/authentication/options] ceremony setup error');
    return privateJson({ ok: false, error: { message: GENERIC_ERROR } }, { status: 500 });
  }
}
