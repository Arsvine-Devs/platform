import { NextResponse, type NextRequest } from 'next/server';

import { applyAuthCookies, createSession, getSessionFromRequest, isOwner, verifyCsrf } from '@/lib/auth';
import { getClientKey } from '@/lib/client-key';
import { enforceRateLimit } from '@/lib/rate-limit';
import { privateJson } from '@/lib/private-response';
import { clearWebAuthnCeremonyCookie, getWebAuthnCeremonyId, hashSessionBinding, isHardwareOrientedCredential, isRegistrationResponse, verifyRegistration } from '@/lib/webauthn';
import { consumeWebAuthnChallenge, enableOwnerWebAuthn, getOwnerAccount, recordWebAuthnEvent, saveWebAuthnCredential } from '@/lib/webauthn-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC_ERROR = '安全密钥注册失败，请重试。';

function genericFailure(reason: string) {
  console.warn(`[admin/webauthn/registration/verify] ${reason}`);
  return privateJson({ ok: false, error: { message: GENERIC_ERROR } }, { status: 422 });
}

export async function POST(request: NextRequest) {
  const limiter = await enforceRateLimit(`webauthn-registration-verify:${getClientKey(request)}`, 12, 10 * 60_000);
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
    const body = await request.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return genericFailure('invalid request shape');
    const input = body as { ceremonyId?: unknown; response?: unknown };
    if (typeof input.ceremonyId !== 'string' || !isRegistrationResponse(input.response)) return genericFailure('invalid request shape');

    const ceremonyCookie = getWebAuthnCeremonyId(request);
    if (!ceremonyCookie || ceremonyCookie !== input.ceremonyId) return genericFailure('ceremony cookie mismatch');

    const owner = await getOwnerAccount();
    if (!owner || owner.id !== session.userId) return genericFailure('owner missing');

    const challenge = await consumeWebAuthnChallenge({ id: input.ceremonyId, userId: owner.id, type: 'registration' });
    if (!challenge) return genericFailure('challenge missing, expired, or already consumed');
    if (!challenge.sessionBindingHash || challenge.sessionBindingHash !== hashSessionBinding(session.csrf)) return genericFailure('session binding mismatch');

    const registrationResponse = input.response;
    const verification = await verifyRegistration(registrationResponse, challenge.challenge);
    if (!verification.verified) return genericFailure('registration not verified');

    const info = verification.registrationInfo;
    if (!isHardwareOrientedCredential(info.credentialDeviceType, info.credentialBackedUp)) return genericFailure('credential is multi-device or backed up');

    const credential = await saveWebAuthnCredential({
      userId: owner.id,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter,
      label: challenge.label || '安全密钥',
      aaguid: info.aaguid,
      attestationFormat: info.fmt,
      transports: info.credential.transports,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    });

    let sessionOwner = owner;
    if (owner.authMethod === 'password+totp') {
      const enabled = await enableOwnerWebAuthn(owner.id, owner.sessionVersion);
      if (enabled) sessionOwner = enabled;
      else {
        const current = await getOwnerAccount();
        if (!current) return genericFailure('owner changed during registration');
        sessionOwner = current;
      }
    }

    await recordWebAuthnEvent(owner.id, 'registered_webauthn_credential');
    if (owner.authMethod === 'password+totp') await recordWebAuthnEvent(owner.id, 'enabled_owner_webauthn');
    const response = privateJson({ ok: true, data: { credentialId: credential.id, authMethod: 'webauthn' as const } });
    applyAuthCookies(response, createSession(sessionOwner, 'webauthn'));
    clearWebAuthnCeremonyCookie(response);
    return response;
  } catch {
    // Verification-library errors can include ceremony values. Keep the
    // server log classification-only; never persist challenge or credential
    // material through an exception string.
    console.error('[admin/webauthn/registration/verify] verification error');
    return genericFailure('verification error');
  }
}
