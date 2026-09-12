import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from './proxy';

function request(pathname: string, cookie?: string) {
  return new NextRequest(`https://ctrl.arsvine.com${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('admin API proxy boundary', () => {
  it('allows only the login and WebAuthn authentication endpoints without a session cookie', () => {
    expect(proxy(request('/api/admin/login')).status).toBe(200);
    expect(proxy(request('/api/admin/webauthn/authentication/options')).status).toBe(200);
    expect(proxy(request('/api/admin/webauthn/authentication/verify')).status).toBe(200);
  });

  it('requires a session cookie for registration and protected admin endpoints', async () => {
    const registration = proxy(request('/api/admin/webauthn/registration/options'));
    const security = proxy(request('/api/admin/security/credentials'));
    expect(registration.status).toBe(401);
    expect(security.status).toBe(401);
    expect((await registration.json()).error.message).toBe('Unauthorized');
  });
});
