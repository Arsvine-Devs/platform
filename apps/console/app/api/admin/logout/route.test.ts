import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  clearAuthCookies: vi.fn(),
  deleteOidcSession: vi.fn(),
  enforceRateLimit: vi.fn(),
  getClientKey: vi.fn(),
  getSessionFromRequest: vi.fn(),
  oidcSessionIdFromRequest: vi.fn(),
  verifyCsrf: vi.fn(),
  buildLogoutUrl: vi.fn(),
}));

vi.mock('../../../../lib/auth', () => ({
  clearAuthCookies: mocks.clearAuthCookies,
  getSessionFromRequest: mocks.getSessionFromRequest,
  verifyCsrf: mocks.verifyCsrf,
}));
vi.mock('../../../../lib/oidc-session', () => ({
  deleteOidcSession: mocks.deleteOidcSession,
  oidcSessionIdFromRequest: mocks.oidcSessionIdFromRequest,
}));
vi.mock('../../../../lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('../../../../lib/client-key', () => ({ getClientKey: mocks.getClientKey }));
vi.mock('../../../../lib/oidc', () => ({ buildLogoutUrl: mocks.buildLogoutUrl }));

import { POST } from './route';

const session = {
  userId: 'user-1',
  email: 'owner@example.com',
  role: 'owner' as const,
  csrf: 'csrf-token',
  exp: Date.now() + 60_000,
  sessionVersion: 1,
  amr: 'oidc' as const,
  authAt: Date.now(),
  authSource: 'oidc' as const,
  accessToken: 'access-token',
  idToken: 'id-token',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceRateLimit.mockResolvedValue({ ok: true });
  mocks.getClientKey.mockReturnValue('client-key');
  mocks.getSessionFromRequest.mockResolvedValue(session);
  mocks.verifyCsrf.mockReturnValue(true);
  mocks.oidcSessionIdFromRequest.mockReturnValue('session-id');
  mocks.deleteOidcSession.mockResolvedValue(undefined);
  mocks.buildLogoutUrl.mockReturnValue(
    'https://auth.example.com/api/auth/oauth2/end-session?id_token_hint=id-token',
  );
});

describe('POST /api/admin/logout', () => {
  it('deletes the host session and returns the Auth logout handoff', async () => {
    const request = new NextRequest('https://console.example.com/api/admin/logout', {
      method: 'POST',
      headers: {
        cookie: '__Host-console_session=session-id; arsvine_admin_csrf=csrf-token',
        'x-csrf-token': 'csrf-token',
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        authLogoutUrl:
          'https://auth.example.com/api/auth/oauth2/end-session?id_token_hint=id-token',
      },
    });
    expect(mocks.deleteOidcSession).toHaveBeenCalledWith('session-id');
    expect(mocks.clearAuthCookies).toHaveBeenCalledWith(response);
  });
});
