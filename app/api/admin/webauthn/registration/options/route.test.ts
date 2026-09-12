import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const legacySession = { userId: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' as const, csrf: 'csrf-token', exp: Date.now() + 60_000, sessionVersion: 1, amr: 'password+totp' as const, authAt: Date.now() };
const owner = { id: legacySession.userId, email: legacySession.email, role: 'owner' as const, status: 'active' as const, authMethod: 'password+totp' as const, sessionVersion: 1 };

vi.mock('@/lib/auth', () => ({
  getSessionFromRequest: vi.fn(),
  isOwner: vi.fn(),
  verifyCsrf: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/webauthn', () => ({
  applyWebAuthnCeremonyCookie: vi.fn(),
  createRegistrationOptions: vi.fn(),
  getWebAuthnConfig: vi.fn(),
  hashSessionBinding: vi.fn(() => 'binding'),
  isRecentWebAuthnSession: vi.fn(),
  normalizeCredentialLabel: vi.fn((value) => String(value).trim()),
  WEBAUTHN_CHALLENGE_TTL_MS: 300_000,
}));
vi.mock('@/lib/webauthn-store', () => ({
  createWebAuthnChallenge: vi.fn(),
  getOwnerAccount: vi.fn(),
  listActiveWebAuthnCredentials: vi.fn(),
  toStoredWebAuthnCredential: vi.fn((value) => value),
}));

import { getSessionFromRequest, isOwner, verifyCsrf } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { applyWebAuthnCeremonyCookie, createRegistrationOptions, getWebAuthnConfig, isRecentWebAuthnSession } from '@/lib/webauthn';
import { createWebAuthnChallenge, getOwnerAccount, listActiveWebAuthnCredentials } from '@/lib/webauthn-store';
import { POST } from './route';

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 11, retryAfterMs: 600_000 });
  vi.mocked(getSessionFromRequest).mockResolvedValue(legacySession);
  vi.mocked(isOwner).mockReturnValue(true);
  vi.mocked(verifyCsrf).mockReturnValue(true);
  vi.mocked(getOwnerAccount).mockResolvedValue(owner as never);
  vi.mocked(listActiveWebAuthnCredentials).mockResolvedValue([] as never);
  vi.mocked(isRecentWebAuthnSession).mockReturnValue(false);
  vi.mocked(getWebAuthnConfig).mockReturnValue({ rpId: 'ctrl.arsvine.com', origin: 'https://ctrl.arsvine.com', rpName: 'ARSVINE Admin' });
  vi.mocked(createRegistrationOptions).mockResolvedValue({ challenge: 'challenge', rp: { id: 'ctrl.arsvine.com', name: 'ARSVINE Admin' }, user: { id: 'user-id', name: owner.email, displayName: 'ARSVINE Owner' }, pubKeyCredParams: [], timeout: 60_000, attestation: 'direct', authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required', authenticatorAttachment: 'cross-platform' }, excludeCredentials: [], hints: ['security-key'] });
  vi.mocked(createWebAuthnChallenge).mockResolvedValue({ id: '00000000-0000-4000-8000-000000000010' } as never);
});
afterEach(() => {
  vi.clearAllMocks();
});

function request(body: unknown) {
  return new NextRequest('https://ctrl.arsvine.com/api/admin/webauthn/registration/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/webauthn/registration/options', () => {
  it('allows the one-time Owner migration from a legacy session', async () => {
    const response = await POST(request({ label: '日常密钥' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { ceremonyId: '00000000-0000-4000-8000-000000000010' } });
    expect(createWebAuthnChallenge).toHaveBeenCalledWith(expect.objectContaining({ label: '日常密钥', sessionBindingHash: 'binding', type: 'registration' }));
    expect(applyWebAuthnCeremonyCookie).toHaveBeenCalled();
  });

  it('requires recent WebAuthn reauthentication after migration', async () => {
    vi.mocked(getOwnerAccount).mockResolvedValue({ ...owner, authMethod: 'webauthn' } as never);
    const response = await POST(request({ label: '备用密钥' }));
    expect(response.status).toBe(401);
    expect(createRegistrationOptions).not.toHaveBeenCalled();
  });
});
