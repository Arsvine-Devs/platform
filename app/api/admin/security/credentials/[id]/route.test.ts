import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const session = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  role: 'owner' as const,
  csrf: 'csrf-token',
  exp: Date.now() + 60_000,
  sessionVersion: 2,
  amr: 'webauthn' as const,
  authAt: Date.now(),
};
const owner = {
  id: session.userId,
  email: session.email,
  role: 'owner' as const,
  status: 'active' as const,
  authMethod: 'webauthn' as const,
  sessionVersion: 2,
};

vi.mock('@/lib/auth', () => ({
  clearAuthCookies: vi.fn(),
  getSessionFromRequest: vi.fn(),
  isOwner: vi.fn(),
  verifyCsrf: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/webauthn', () => ({
  clearWebAuthnCeremonyCookie: vi.fn(),
  isRecentWebAuthnSession: vi.fn(),
}));
vi.mock('@/lib/webauthn-store', () => ({
  getOwnerAccount: vi.fn(),
  revokeWebAuthnCredential: vi.fn(),
}));

import { clearAuthCookies, getSessionFromRequest, isOwner, verifyCsrf } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { clearWebAuthnCeremonyCookie, isRecentWebAuthnSession } from '@/lib/webauthn';
import { getOwnerAccount, revokeWebAuthnCredential } from '@/lib/webauthn-store';
import { DELETE } from './route';

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 11, retryAfterMs: 600_000 });
  vi.mocked(getSessionFromRequest).mockResolvedValue(session);
  vi.mocked(isOwner).mockReturnValue(true);
  vi.mocked(verifyCsrf).mockReturnValue(true);
  vi.mocked(isRecentWebAuthnSession).mockReturnValue(true);
  vi.mocked(getOwnerAccount).mockResolvedValue(owner as never);
  vi.mocked(revokeWebAuthnCredential).mockResolvedValue({ id: 'credential-record' });
});
afterEach(() => {
  vi.clearAllMocks();
});

function request() {
  return new NextRequest(
    'https://ctrl.arsvine.com/api/admin/security/credentials/credential-record',
    {
      method: 'DELETE',
      headers: { 'x-csrf-token': 'csrf-token' },
    },
  );
}

describe('DELETE /api/admin/security/credentials/[id]', () => {
  it('requires recent WebAuthn and invalidates sessions after revocation', async () => {
    const response = await DELETE(request(), {
      params: Promise.resolve({ id: 'credential-record' }),
    });
    expect(response.status).toBe(200);
    expect(revokeWebAuthnCredential).toHaveBeenCalledWith(owner.id, 'credential-record');
    expect(clearAuthCookies).toHaveBeenCalled();
    expect(clearWebAuthnCeremonyCookie).toHaveBeenCalled();
  });

  it('rejects revocation when the store protects the last key', async () => {
    vi.mocked(revokeWebAuthnCredential).mockRejectedValue(new Error('至少保留一枚安全密钥。'));
    const response = await DELETE(request(), {
      params: Promise.resolve({ id: 'credential-record' }),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain('至少保留一枚');
  });

  it('rejects stale sessions before touching credential state', async () => {
    vi.mocked(isRecentWebAuthnSession).mockReturnValue(false);
    const response = await DELETE(request(), {
      params: Promise.resolve({ id: 'credential-record' }),
    });
    expect(response.status).toBe(401);
    expect(revokeWebAuthnCredential).not.toHaveBeenCalled();
  });
});
