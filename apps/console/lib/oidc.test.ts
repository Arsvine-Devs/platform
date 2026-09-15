import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthorizationRequest, buildLogoutUrl } from './oidc';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildAuthorizationRequest', () => {
  it('uses the source-controlled OAuth resource and callback', () => {
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'console');

    const { authorizationUrl } = buildAuthorizationRequest('/library');

    const url = new URL(authorizationUrl);
    expect(url.origin).toBe('https://auth.arsvine.com');
    expect(url.searchParams.get('resource')).toBe('https://api.arsvine.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://console.arsvine.com/auth/callback');
  });
});

describe('buildLogoutUrl', () => {
  it('builds an Auth RP-initiated logout request with the registered return URI', () => {
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'console');

    const url = new URL(buildLogoutUrl('id-token'));

    expect(url.origin).toBe('https://auth.arsvine.com');
    expect(url.pathname).toBe('/api/auth/oauth2/end-session');
    expect(url.searchParams.get('id_token_hint')).toBe('id-token');
    expect(url.searchParams.get('client_id')).toBe('console');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://console.arsvine.com/auth/signed-out',
    );
  });
});
