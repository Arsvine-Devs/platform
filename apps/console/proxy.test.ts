import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from './proxy';

function request(pathname: string, cookie?: string) {
  return new NextRequest(`https://console.arsvine.com${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('Console control-plane boundary', () => {
  it('retires every legacy admin endpoint', async () => {
    const response = proxy(request('/api/admin/webauthn/registration/options'));
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe('LEGACY_ADMIN_API_RETIRED');
  });

  it('requires the host-only OIDC session for the new BFF', async () => {
    const unauthorized = proxy(request('/api/control/library'));
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).error.message).toBe('Unauthorized');

    const authorized = proxy(request('/api/control/library', '__Host-console_session=session'));
    expect(authorized.status).toBe(200);
  });
});
