import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./accounts')>();
  return { ...actual, getActiveAccount: vi.fn() };
});

import { getActiveAccount, hashPassword, verifyPasswordHash } from './accounts';
import { createSession, getSessionFromRequest } from './auth';
import { NextRequest } from 'next/server';

beforeEach(() => { vi.stubEnv('SESSION_SECRET', 'test-session-secret'); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('password hashes', () => {
  it('accepts the generated hash and rejects a wrong password', () => {
    const encoded = hashPassword('correct horse battery staple');
    expect(verifyPasswordHash('correct horse battery staple', encoded)).toBe(true);
    expect(verifyPasswordHash('wrong password', encoded)).toBe(false);
  });
});

describe('signed sessions', () => {
  it('resolves an active account with the same session version', async () => {
    const account = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' as const, authMethod: 'password+totp' as const, sessionVersion: 2, status: 'active' as const };
    vi.mocked(getActiveAccount).mockResolvedValue(account as never);
    const session = createSession(account);
    const request = new NextRequest('http://localhost/library', { headers: { cookie: `arsvine_admin_session=${session.value}` } });
    await expect(getSessionFromRequest(request)).resolves.toMatchObject({ userId: account.id, email: account.email, role: 'owner', sessionVersion: 2, csrf: session.csrf, amr: 'password+totp', authAt: expect.any(Number) });
  });

  it('rejects a tampered session before querying the account', async () => {
    const session = createSession({ id: '00000000-0000-4000-8000-000000000001', role: 'owner', sessionVersion: 1 });
    const raw = JSON.parse(Buffer.from(session.value, 'base64url').toString('utf8')) as Record<string, unknown>;
    raw.role = 'editor';
    const request = new NextRequest('http://localhost/library', { headers: { cookie: `arsvine_admin_session=${Buffer.from(JSON.stringify(raw)).toString('base64url')}` } });
    await expect(getSessionFromRequest(request)).resolves.toBeNull();
    expect(getActiveAccount).not.toHaveBeenCalled();
  });

  it('rejects an Owner legacy session after the account switches to WebAuthn', async () => {
    const account = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' as const, authMethod: 'webauthn' as const, sessionVersion: 1, status: 'active' as const };
    vi.mocked(getActiveAccount).mockResolvedValue(account as never);
    const session = createSession(account, 'password+totp');
    const request = new NextRequest('http://localhost/library', { headers: { cookie: `arsvine_admin_session=${session.value}` } });
    await expect(getSessionFromRequest(request)).resolves.toBeNull();
  });

  it('resolves a WebAuthn session for a migrated Owner', async () => {
    const account = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' as const, authMethod: 'webauthn' as const, sessionVersion: 3, status: 'active' as const };
    vi.mocked(getActiveAccount).mockResolvedValue(account as never);
    const session = createSession(account, 'webauthn');
    const request = new NextRequest('http://localhost/library', { headers: { cookie: `arsvine_admin_session=${session.value}` } });
    await expect(getSessionFromRequest(request)).resolves.toMatchObject({ amr: 'webauthn', authAt: expect.any(Number) });
  });
});
