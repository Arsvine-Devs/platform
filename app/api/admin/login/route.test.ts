import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/accounts', () => ({ ensureOwnerBootstrap: vi.fn(), getAccountByEmail: vi.fn(), verifyPasswordHash: vi.fn() }));
vi.mock('../../../../lib/secrets', () => ({ decryptSecret: vi.fn() }));
vi.mock('../../../../lib/totp', () => ({ verifyTotp: vi.fn() }));
vi.mock('../../../../lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }));

import { POST } from './route';
import { ensureOwnerBootstrap, getAccountByEmail, verifyPasswordHash } from '../../../../lib/accounts';
import { decryptSecret } from '../../../../lib/secrets';
import { verifyTotp } from '../../../../lib/totp';
import { enforceRateLimit } from '../../../../lib/rate-limit';

const account = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' as const, status: 'active' as const, authMethod: 'password+totp' as const, sessionVersion: 1, passwordHash: 'hash', totpEncrypted: 'cipher' };
const editor = { ...account, id: '00000000-0000-4000-8000-000000000002', email: 'editor@example.com', role: 'editor' as const };
function request(body: unknown) { return new Request('http://localhost/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never; }

beforeEach(() => { vi.stubEnv('SESSION_SECRET', 'test-session-secret'); vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true, remaining: 4, retryAfterMs: 60_000 }); vi.mocked(ensureOwnerBootstrap).mockResolvedValue(account as never); vi.mocked(getAccountByEmail).mockResolvedValue(account as never); vi.mocked(verifyPasswordHash).mockReturnValue(true); vi.mocked(decryptSecret).mockReturnValue(JSON.stringify({ current: 'JBSWY3DPEHPK3PXP' })); vi.mocked(verifyTotp).mockReturnValue(true); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('POST /api/admin/login', () => {
  it('does not query credentials for incomplete input', async () => {
    const response = await POST(request({ email: 'owner@example.com', password: '' }));
    expect(response.status).toBe(401); expect(getAccountByEmail).not.toHaveBeenCalled();
  });
  it('returns a generic failure for invalid credentials', async () => {
    vi.mocked(verifyPasswordHash).mockReturnValue(false);
    const response = await POST(request({ email: 'owner@example.com', password: 'wrong', totpToken: '123456' }));
    expect(response.status).toBe(401); expect((await response.json()).error.message).toBe('登录失败，请检查凭据。');
  });
  it('creates signed auth and csrf cookies only after password and TOTP pass', async () => {
    const response = await POST(request({ email: 'owner@example.com', password: 'correct', totpToken: '123456' }));
    expect(response.status).toBe(200); expect(response.cookies.get('arsvine_admin_session')?.value).toBeTruthy(); expect(response.cookies.get('arsvine_admin_csrf')?.value).toBeTruthy();
  });
  it('accepts a configured previous TOTP secret during rotation', async () => {
    vi.mocked(decryptSecret).mockReturnValue(JSON.stringify({ current: 'CURRENT', previous: ['PREVIOUS'] }));
    vi.mocked(verifyTotp).mockReturnValueOnce(false).mockReturnValueOnce(true);
    const response = await POST(request({ email: 'owner@example.com', password: 'correct', totpToken: '123456' }));
    expect(response.status).toBe(200);
    expect(verifyTotp).toHaveBeenCalledTimes(2);
  });

  it('rejects the legacy Owner form after WebAuthn migration', async () => {
    vi.mocked(getAccountByEmail).mockResolvedValue({ ...account, authMethod: 'webauthn' } as never);
    const response = await POST(request({ email: 'owner@example.com', password: 'correct', totpToken: '123456' }));
    expect(response.status).toBe(401);
    expect(verifyPasswordHash).not.toHaveBeenCalled();
  });

  it('keeps password plus TOTP login for Editors', async () => {
    vi.mocked(getAccountByEmail).mockResolvedValue(editor as never);
    const response = await POST(request({ email: editor.email, password: 'correct', totpToken: '123456' }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ role: 'editor', authMethod: 'password+totp', needsWebAuthnSetup: false });
  });
});
