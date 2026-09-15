import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthorizationRequest, buildLogoutUrl } from './oidc';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildAuthorizationRequest', () => {
  it('requires the configured OAuth resource instead of an API fallback', () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret');
    vi.stubEnv('AUTH_OIDC_AUTHORIZATION_URL', 'https://auth.example.com/api/auth/oauth2/authorize');
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'console');
    vi.stubEnv('AUTH_OIDC_REDIRECT_URI', 'https://console.example.com/auth/callback');
    vi.stubEnv('AUTH_OIDC_RESOURCE', 'https://api.example.com');
    vi.stubEnv('API_PUBLIC_URL', 'https://wrong.example.com');

    const { authorizationUrl } = buildAuthorizationRequest('/library');

    expect(new URL(authorizationUrl).searchParams.get('resource')).toBe('https://api.example.com');
  });
});

describe('buildLogoutUrl', () => {
  it('builds an Auth RP-initiated logout request with the registered return URI', () => {
    vi.stubEnv('AUTH_OIDC_END_SESSION_URL', 'https://auth.example.com/api/auth/oauth2/end-session');
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'console');
    vi.stubEnv('AUTH_OIDC_POST_LOGOUT_REDIRECT_URI', 'https://console.example.com/auth/signed-out');

    const url = new URL(buildLogoutUrl('id-token'));

    expect(url.origin).toBe('https://auth.example.com');
    expect(url.pathname).toBe('/api/auth/oauth2/end-session');
    expect(url.searchParams.get('id_token_hint')).toBe('id-token');
    expect(url.searchParams.get('client_id')).toBe('console');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://console.example.com/auth/signed-out',
    );
  });
});
