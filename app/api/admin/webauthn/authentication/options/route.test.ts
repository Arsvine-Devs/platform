import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/webauthn', () => ({
  applyWebAuthnCeremonyCookie: vi.fn(),
  createAuthenticationOptions: vi.fn(),
  getWebAuthnConfig: vi.fn(),
  WEBAUTHN_CHALLENGE_TTL_MS: 300_000,
}));
vi.mock('@/lib/webauthn-store', () => ({
  createWebAuthnChallenge: vi.fn(),
  getOwnerAccount: vi.fn(),
  listActiveWebAuthnCredentials: vi.fn(),
  toStoredWebAuthnCredential: vi.fn((value) => value),
}));

import { enforceRateLimit } from '@/lib/rate-limit';
import {
  applyWebAuthnCeremonyCookie,
  createAuthenticationOptions,
  getWebAuthnConfig,
} from '@/lib/webauthn';
import {
  createWebAuthnChallenge,
  getOwnerAccount,
  listActiveWebAuthnCredentials,
} from '@/lib/webauthn-store';
import { POST } from './route';

const owner = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'owner' as const,
  status: 'active' as const,
  authMethod: 'webauthn' as const,
};

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 11, retryAfterMs: 600_000 });
  vi.mocked(getOwnerAccount).mockResolvedValue(owner as never);
  vi.mocked(listActiveWebAuthnCredentials).mockResolvedValue([
    {
      id: 'record',
      credentialId: 'credential',
      publicKey: 'public',
      counter: 0,
      label: 'key',
      aaguid: 'aaguid',
      attestationFormat: 'packed',
      transports: '["usb"]',
      deviceType: 'singleDevice',
      backedUp: false,
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    },
  ] as never);
  vi.mocked(getWebAuthnConfig).mockReturnValue({
    rpId: 'ctrl.arsvine.com',
    origin: 'https://ctrl.arsvine.com',
    rpName: 'ARSVINE Admin',
  });
  vi.mocked(createAuthenticationOptions).mockResolvedValue({
    challenge: 'challenge',
    rpId: 'ctrl.arsvine.com',
    allowCredentials: [],
    userVerification: 'required',
  });
  vi.mocked(createWebAuthnChallenge).mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000010',
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

function request() {
  return new NextRequest('https://ctrl.arsvine.com/api/admin/webauthn/authentication/options', {
    method: 'POST',
  });
}

describe('POST /api/admin/webauthn/authentication/options', () => {
  it('returns options and binds a short-lived ceremony cookie', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { ceremonyId: '00000000-0000-4000-8000-000000000010' },
    });
    expect(createWebAuthnChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'authentication', challenge: 'challenge', userId: owner.id }),
    );
    expect(applyWebAuthnCeremonyCookie).toHaveBeenCalled();
  });

  it('does not expose authentication options before Owner migration', async () => {
    vi.mocked(getOwnerAccount).mockResolvedValue({
      ...owner,
      authMethod: 'password+totp',
    } as never);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(createAuthenticationOptions).not.toHaveBeenCalled();
  });

  it('does not initialize an Owner or create a challenge from the public endpoint', async () => {
    vi.mocked(getOwnerAccount).mockResolvedValue(null as never);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(createWebAuthnChallenge).not.toHaveBeenCalled();
  });
});
