import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../lib/accounts', () => ({
  acceptInvitation: vi.fn(),
  activateInvitation: vi.fn(),
  getAccountById: vi.fn(),
  hashPassword: vi.fn(() => 'password-hash'),
}));
vi.mock('../../../../../lib/activation', () => ({
  createActivationToken: vi.fn(() => 'activation-token'),
  readActivationToken: vi.fn(),
}));
vi.mock('../../../../../lib/auth', () => ({
  applyAuthCookies: vi.fn(),
  createSession: vi.fn(() => ({ value: 'session', csrf: 'csrf', exp: Date.now() + 60_000 })),
}));
vi.mock('../../../../../lib/client-key', () => ({ getClientKey: vi.fn(() => 'client') }));
vi.mock('../../../../../lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../../../../lib/secrets', () => ({ decryptSecret: vi.fn() }));
vi.mock('../../../../../lib/totp', () => ({
  createTotpUri: vi.fn(() => 'otpauth://totp/example'),
  generateTotpSecret: vi.fn(() => 'JBSWY3DPEHPK3PXP'),
  verifyTotp: vi.fn(),
}));

import { acceptInvitation, activateInvitation, getAccountById } from '../../../../../lib/accounts';
import { readActivationToken } from '../../../../../lib/activation';
import { applyAuthCookies } from '../../../../../lib/auth';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { decryptSecret } from '../../../../../lib/secrets';
import { verifyTotp } from '../../../../../lib/totp';
import { POST } from './route';

const account = { id: '00000000-0000-4000-8000-000000000002', email: 'editor@example.com', role: 'editor' as const, status: 'pending' as const, passwordHash: 'password-hash', totpEncrypted: 'encrypted', sessionVersion: 1 };

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 11, retryAfterMs: 900_000 });
  vi.mocked(acceptInvitation).mockResolvedValue({ account, invite: { id: '00000000-0000-4000-8000-000000000003' } } as never);
  vi.mocked(readActivationToken).mockReturnValue({ invitationId: '00000000-0000-4000-8000-000000000003', userId: account.id, exp: Date.now() + 60_000, sig: 'signature' });
  vi.mocked(getAccountById).mockResolvedValue(account as never);
  vi.mocked(decryptSecret).mockReturnValue(JSON.stringify({ current: 'JBSWY3DPEHPK3PXP', period: 30, digits: 6, window: 1 }));
  vi.mocked(verifyTotp).mockReturnValue(true);
  vi.mocked(activateInvitation).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

it('rate-limits invitation activation attempts', async () => {
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: false, remaining: 0, retryAfterMs: 60_000 });
  const response = await POST(new NextRequest('https://ctrl.arsvine.com/api/auth/invitations/activate', { method: 'POST', body: JSON.stringify({ phase: 'start' }) }));
  expect(response.status).toBe(429);
  expect(acceptInvitation).not.toHaveBeenCalled();
});

it('activates an invitation only after the TOTP enrollment is verified', async () => {
  const response = await POST(new NextRequest('https://ctrl.arsvine.com/api/auth/invitations/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'arsvine_invitation_activation=activation-token' },
    body: JSON.stringify({ phase: 'verify', totpToken: '123456' }),
  }));
  expect(response.status).toBe(200);
  expect(verifyTotp).toHaveBeenCalled();
  expect(activateInvitation).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000003', account.id);
  expect(applyAuthCookies).toHaveBeenCalled();
});
