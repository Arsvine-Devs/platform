import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const session = { userId: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' as const, csrf: 'csrf-token', exp: Date.now() + 60_000, sessionVersion: 1, amr: 'password+totp' as const, authAt: Date.now() };
const owner = { id: session.userId, email: session.email, role: 'owner' as const, status: 'active' as const, authMethod: 'password+totp' as const, sessionVersion: 1 };
const registrationResponse = { id: 'credential-id', rawId: 'credential-id', type: 'public-key', response: { clientDataJSON: 'client-data', attestationObject: 'attestation-object' } };

vi.mock('@/lib/auth', () => ({
  applyAuthCookies: vi.fn(),
  createSession: vi.fn(() => ({ value: 'session', csrf: 'new-csrf', exp: Date.now() + 60_000 })),
  getSessionFromRequest: vi.fn(),
  isOwner: vi.fn(),
  verifyCsrf: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/webauthn', () => ({
  clearWebAuthnCeremonyCookie: vi.fn(),
  getWebAuthnCeremonyId: vi.fn(),
  hashSessionBinding: vi.fn(() => 'binding'),
  isHardwareOrientedCredential: vi.fn(),
  isRegistrationResponse: vi.fn(),
  verifyRegistration: vi.fn(),
}));
vi.mock('@/lib/webauthn-store', () => ({
  consumeWebAuthnChallenge: vi.fn(),
  enableOwnerWebAuthn: vi.fn(),
  getOwnerAccount: vi.fn(),
  recordWebAuthnEvent: vi.fn(),
  saveWebAuthnCredential: vi.fn(),
}));

import { applyAuthCookies, createSession, getSessionFromRequest, isOwner, verifyCsrf } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { clearWebAuthnCeremonyCookie, getWebAuthnCeremonyId, hashSessionBinding, isHardwareOrientedCredential, isRegistrationResponse, verifyRegistration } from '@/lib/webauthn';
import { consumeWebAuthnChallenge, enableOwnerWebAuthn, getOwnerAccount, recordWebAuthnEvent, saveWebAuthnCredential } from '@/lib/webauthn-store';
import { POST } from './route';

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 11, retryAfterMs: 600_000 });
  vi.mocked(getSessionFromRequest).mockResolvedValue(session);
  vi.mocked(isOwner).mockReturnValue(true);
  vi.mocked(verifyCsrf).mockReturnValue(true);
  vi.mocked(getWebAuthnCeremonyId).mockReturnValue('00000000-0000-4000-8000-000000000010');
  vi.mocked(isRegistrationResponse).mockReturnValue(true);
  vi.mocked(getOwnerAccount).mockResolvedValue(owner as never);
  vi.mocked(consumeWebAuthnChallenge).mockResolvedValue({ id: '00000000-0000-4000-8000-000000000010', userId: owner.id, type: 'registration', challenge: 'challenge', rpId: 'ctrl.arsvine.com', origin: 'https://ctrl.arsvine.com', label: '日常密钥', sessionBindingHash: 'binding', expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date(), createdAt: new Date() } as never);
  vi.mocked(verifyRegistration).mockResolvedValue({ verified: true, registrationInfo: { fmt: 'packed', aaguid: 'aaguid', credential: { id: 'credential-id', publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['usb'] }, credentialType: 'public-key', attestationObject: new Uint8Array([1]), userVerified: true, credentialDeviceType: 'singleDevice', credentialBackedUp: false, origin: 'https://ctrl.arsvine.com', rpID: 'ctrl.arsvine.com' } });
  vi.mocked(isHardwareOrientedCredential).mockReturnValue(true);
  vi.mocked(saveWebAuthnCredential).mockResolvedValue({ id: 'credential-record' } as never);
  vi.mocked(enableOwnerWebAuthn).mockResolvedValue({ ...owner, authMethod: 'webauthn', sessionVersion: 2 } as never);
  vi.mocked(recordWebAuthnEvent).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function request(body: unknown) {
  return new NextRequest('https://ctrl.arsvine.com/api/admin/webauthn/registration/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'arsvine_webauthn_ceremony=00000000-0000-4000-8000-000000000010' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/webauthn/registration/verify', () => {
  it('switches the Owner to WebAuthn and issues a fresh session', async () => {
    const response = await POST(request({ ceremonyId: '00000000-0000-4000-8000-000000000010', response: registrationResponse }));
    expect(response.status).toBe(200);
    expect(saveWebAuthnCredential).toHaveBeenCalledWith(expect.objectContaining({ label: '日常密钥', credentialId: 'credential-id' }));
    expect(enableOwnerWebAuthn).toHaveBeenCalledWith(owner.id, owner.sessionVersion);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ authMethod: 'webauthn', sessionVersion: 2 }), 'webauthn');
    expect(applyAuthCookies).toHaveBeenCalled();
    expect(clearWebAuthnCeremonyCookie).toHaveBeenCalled();
  });

  it('rejects a session binding mismatch', async () => {
    vi.mocked(hashSessionBinding).mockReturnValue('different-binding');
    const response = await POST(request({ ceremonyId: '00000000-0000-4000-8000-000000000010', response: registrationResponse }));
    expect(response.status).toBe(422);
    expect(verifyRegistration).not.toHaveBeenCalled();
  });

  it('rejects a multi-device registration', async () => {
    vi.mocked(isHardwareOrientedCredential).mockReturnValue(false);
    const response = await POST(request({ ceremonyId: '00000000-0000-4000-8000-000000000010', response: registrationResponse }));
    expect(response.status).toBe(422);
    expect(saveWebAuthnCredential).not.toHaveBeenCalled();
  });
});
