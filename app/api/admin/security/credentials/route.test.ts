import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  getSessionFromRequest: vi.fn(),
  isOwner: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/webauthn', () => ({ parseCredentialTransports: vi.fn(() => ['usb']) }));
vi.mock('@/lib/webauthn-store', () => ({
  getOwnerAccount: vi.fn(),
  listActiveWebAuthnCredentials: vi.fn(),
}));

import { getSessionFromRequest, isOwner } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getOwnerAccount, listActiveWebAuthnCredentials } from '@/lib/webauthn-store';
import { GET } from './route';

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 59, retryAfterMs: 60_000 });
  vi.mocked(getSessionFromRequest).mockResolvedValue(session);
  vi.mocked(isOwner).mockReturnValue(true);
  vi.mocked(getOwnerAccount).mockResolvedValue(owner as never);
  vi.mocked(listActiveWebAuthnCredentials).mockResolvedValue([
    {
      id: 'record',
      credentialId: 'private-credential-id',
      publicKey: 'private-public-key',
      counter: 3,
      label: '日常密钥',
      aaguid: 'aaguid',
      attestationFormat: 'packed',
      transports: '["usb"]',
      deviceType: 'singleDevice',
      backedUp: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
    },
  ] as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

it('returns safe credential metadata with private no-store headers', async () => {
  const response = await GET(
    new NextRequest('https://ctrl.arsvine.com/api/admin/security/credentials'),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const body = await response.json();
  expect(body.data.credentials[0]).toMatchObject({
    label: '日常密钥',
    aaguid: 'aaguid',
    transports: ['usb'],
  });
  expect(body.data.credentials[0].publicKey).toBeUndefined();
  expect(body.data.credentials[0].credentialId).toBeUndefined();
});
