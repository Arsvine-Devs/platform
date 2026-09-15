import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-session-secret');
  vi.stubEnv('AUTH_OIDC_ISSUER', 'https://auth.example.com');
  vi.stubEnv('AUTH_OIDC_AUTHORIZATION_URL', 'https://auth.example.com/authorize');
  vi.stubEnv('AUTH_OIDC_TOKEN_URL', 'https://auth.example.com/token');
  vi.stubEnv('AUTH_OIDC_USERINFO_URL', 'https://auth.example.com/userinfo');
  vi.stubEnv('AUTH_OIDC_JWKS_URL', 'https://auth.example.com/jwks');
  vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'console');
  vi.stubEnv('AUTH_OIDC_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('AUTH_OIDC_REDIRECT_URI', 'https://console.example.com/auth/callback');
  vi.stubEnv('AUTH_OIDC_END_SESSION_URL', 'https://auth.example.com/end-session');
  vi.stubEnv('AUTH_OIDC_POST_LOGOUT_REDIRECT_URI', 'https://console.example.com/auth/signed-out');
  vi.stubEnv('AUTH_OIDC_RESOURCE', 'https://api.example.com');
  vi.stubEnv('API_BASE_URL', 'https://api.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /health/ready', () => {
  it('returns ready when the BFF configuration is complete', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', service: 'console' });
  });

  it('reports missing required configuration without exposing values', async () => {
    vi.stubEnv('SESSION_SECRET', '');

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'not_ready',
      service: 'console',
      reason: 'missing_configuration:SESSION_SECRET',
    });
  });
});
