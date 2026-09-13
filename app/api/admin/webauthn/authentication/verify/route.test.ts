import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/accounts', () => ({
  getActiveAccount: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(),
}));
vi.mock('@/lib/webauthn', () => ({
  clearWebAuthnCeremonyCookie: vi.fn(),
  getWebAuthnCeremonyId: vi.fn(),
  isAuthenticationResponse: vi.fn(),
  isHardwareOrientedCredential: vi.fn(),
  verifyAuthentication: vi.fn(),
}));
vi.mock('@/lib/webauthn-store', () => ({
  consumeWebAuthnChallenge: vi.fn(),
  getActiveWebAuthnCredential: vi.fn(),
  getOwnerAccount: vi.fn(),
  recordWebAuthnEvent: vi.fn(),
  toWebAuthnVerificationCredential: vi.fn(),
  updateWebAuthnCredentialAfterAuthentication: vi.fn(),
}));

import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getWebAuthnCeremonyId,
  isAuthenticationResponse,
  isHardwareOrientedCredential,
  verifyAuthentication,
} from '@/lib/webauthn';
import {
  consumeWebAuthnChallenge,
  getActiveWebAuthnCredential,
  getOwnerAccount,
  recordWebAuthnEvent,
  toWebAuthnVerificationCredential,
  updateWebAuthnCredentialAfterAuthentication,
} from '@/lib/webauthn-store';
import { POST } from './route';

const owner = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  role: 'owner' as const,
  status: 'active' as const,
  authMethod: 'webauthn' as const,
  sessionVersion: 1,
};
const storedCredential = {
  id: 'credential-record',
  credentialId: 'credential-id',
  publicKey: 'public-key',
  counter: 2,
  transports: '["usb"]',
};
const authenticationResponse = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key',
  response: {
    clientDataJSON: 'client-data',
    authenticatorData: 'authenticator-data',
    signature: 'signature',
  },
};

function request(body: unknown, ceremonyId = '00000000-0000-4000-8000-000000000010') {
  return new NextRequest('https://ctrl.arsvine.com/api/admin/webauthn/authentication/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `arsvine_webauthn_ceremony=${ceremonyId}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-session-secret');
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 11, retryAfterMs: 600_000 });
  vi.mocked(getOwnerAccount).mockResolvedValue(owner as never);
  vi.mocked(getWebAuthnCeremonyId).mockReturnValue('00000000-0000-4000-8000-000000000010');
  vi.mocked(isAuthenticationResponse).mockReturnValue(true);
  vi.mocked(consumeWebAuthnChallenge).mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000010',
    userId: owner.id,
    type: 'authentication',
    challenge: 'challenge',
    rpId: 'ctrl.arsvine.com',
    origin: 'https://ctrl.arsvine.com',
    label: null,
    sessionBindingHash: null,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: new Date(),
    createdAt: new Date(),
  } as never);
  vi.mocked(getActiveWebAuthnCredential).mockResolvedValue(storedCredential as never);
  vi.mocked(toWebAuthnVerificationCredential).mockReturnValue({
    id: 'credential-id',
    publicKey: new Uint8Array([1]),
    counter: 2,
    transports: ['usb'],
  });
  vi.mocked(verifyAuthentication).mockResolvedValue({
    verified: true,
    authenticationInfo: {
      credentialID: 'credential-id',
      newCounter: 3,
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'https://ctrl.arsvine.com',
      rpID: 'ctrl.arsvine.com',
    },
  });
  vi.mocked(isHardwareOrientedCredential).mockReturnValue(true);
  vi.mocked(updateWebAuthnCredentialAfterAuthentication).mockResolvedValue(
    storedCredential as never,
  );
  vi.mocked(recordWebAuthnEvent).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/admin/webauthn/authentication/verify', () => {
  it('creates a WebAuthn session only after challenge and assertion verification', async () => {
    const response = await POST(
      request({
        ceremonyId: '00000000-0000-4000-8000-000000000010',
        response: authenticationResponse,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.cookies.get('arsvine_admin_session')?.value).toBeTruthy();
    expect(response.cookies.get('arsvine_admin_csrf')?.value).toBeTruthy();
    expect(consumeWebAuthnChallenge).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000010',
      userId: owner.id,
      type: 'authentication',
    });
    expect(updateWebAuthnCredentialAfterAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({ counter: 3, credentialId: 'credential-id' }),
    );
    expect(recordWebAuthnEvent).toHaveBeenCalledWith(owner.id, 'webauthn_login');
  });

  it('rejects a ceremony cookie mismatch without consuming a challenge', async () => {
    vi.mocked(getWebAuthnCeremonyId).mockReturnValue('different-ceremony');
    const response = await POST(
      request({
        ceremonyId: '00000000-0000-4000-8000-000000000010',
        response: authenticationResponse,
      }),
    );
    expect(response.status).toBe(401);
    expect(consumeWebAuthnChallenge).not.toHaveBeenCalled();
  });

  it('rejects a multi-device credential before creating a session', async () => {
    vi.mocked(isHardwareOrientedCredential).mockReturnValue(false);
    const response = await POST(
      request({
        ceremonyId: '00000000-0000-4000-8000-000000000010',
        response: authenticationResponse,
      }),
    );
    expect(response.status).toBe(401);
    expect(updateWebAuthnCredentialAfterAuthentication).not.toHaveBeenCalled();
  });
});
