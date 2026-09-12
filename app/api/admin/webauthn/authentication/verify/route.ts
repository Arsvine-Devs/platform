import { NextResponse, type NextRequest } from 'next/server';

import { getClientKey } from '@/lib/client-key';
import { createSession, applyAuthCookies } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { privateJson } from '@/lib/private-response';
import { clearWebAuthnCeremonyCookie, getWebAuthnCeremonyId, isAuthenticationResponse, isHardwareOrientedCredential, verifyAuthentication } from '@/lib/webauthn';
import { consumeWebAuthnChallenge, getActiveWebAuthnCredential, getOwnerAccount, recordWebAuthnEvent, toWebAuthnVerificationCredential, updateWebAuthnCredentialAfterAuthentication } from '@/lib/webauthn-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC_ERROR = '安全密钥登录失败，请检查密钥后重试。';

function genericFailure(reason: string) {
  console.warn(`[admin/webauthn/authentication/verify] ${reason}`);
  return privateJson({ ok: false, error: { message: GENERIC_ERROR } }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const limiter = await enforceRateLimit(`webauthn-auth-verify:${getClientKey(request)}`, 12, 10 * 60_000);
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '请求过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return genericFailure('invalid request shape');
    const input = body as { ceremonyId?: unknown; response?: unknown };
    if (typeof input.ceremonyId !== 'string' || !isAuthenticationResponse(input.response)) return genericFailure('invalid request shape');

    const ceremonyCookie = getWebAuthnCeremonyId(request);
    if (!ceremonyCookie || ceremonyCookie !== input.ceremonyId) return genericFailure('ceremony cookie mismatch');

    const owner = await getOwnerAccount();
    if (!owner) return genericFailure('owner is not initialized');
    if (owner.status !== 'active' || owner.authMethod !== 'webauthn') return genericFailure('owner is not using WebAuthn');

    const challenge = await consumeWebAuthnChallenge({ id: input.ceremonyId, userId: owner.id, type: 'authentication' });
    if (!challenge) return genericFailure('challenge missing, expired, or already consumed');

    const authenticationResponse = input.response;
    const credential = await getActiveWebAuthnCredential(owner.id, authenticationResponse.id);
    if (!credential) return genericFailure('credential not found');

    const verification = await verifyAuthentication(
      authenticationResponse,
      toWebAuthnVerificationCredential(credential),
      challenge.challenge,
    );
    if (!verification.verified) return genericFailure('assertion not verified');

    const info = verification.authenticationInfo;
    if (!isHardwareOrientedCredential(info.credentialDeviceType, info.credentialBackedUp)) {
      return genericFailure('credential is multi-device or backed up');
    }

    const updated = await updateWebAuthnCredentialAfterAuthentication({
      userId: owner.id,
      credentialId: info.credentialID,
      counter: info.newCounter,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    });
    if (!updated) return genericFailure('credential was revoked during authentication');

    await recordWebAuthnEvent(owner.id, 'webauthn_login');
    const response = privateJson({ ok: true });
    applyAuthCookies(response, createSession(owner, 'webauthn'));
    clearWebAuthnCeremonyCookie(response);
    return response;
  } catch {
    // Verification-library errors can include ceremony values. Keep the
    // server log classification-only; never persist challenge or credential
    // material through an exception string.
    console.error('[admin/webauthn/authentication/verify] verification error');
    return genericFailure('verification error');
  }
}
