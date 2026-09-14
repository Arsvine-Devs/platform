import { NextResponse, type NextRequest } from 'next/server';
import { applyAuthCookies, createSession } from '../../../../lib/auth';
import {
  ensureOwnerBootstrap,
  getAccountByEmail,
  verifyPasswordHash,
} from '../../../../lib/accounts';
import { decryptSecret } from '../../../../lib/secrets';
import { verifyTotp, type TotpSecretConfig } from '../../../../lib/totp';
import { getClientKey } from '../../../../lib/client-key';
import { enforceRateLimit } from '../../../../lib/rate-limit';

const GENERIC_LOGIN_ERROR = '登录失败，请检查凭据。';
const GENERIC_SERVER_ERROR = '登录失败，请稍后重试。';

function isConfigurationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith('Missing ') || error.message.includes('ENCRYPTION_KEY');
}

// All credential failures collapse to a single generic 401 — never reveal
// which factor failed, whether TOTP is enforced, or whether a field was
// missing vs wrong. The exact reason is logged server-side so operators
// can still diagnose problems.
function genericFailure(reason: string) {
  console.warn(`[admin/login] auth failure: ${reason}`);
  return NextResponse.json({ ok: false, error: { message: GENERIC_LOGIN_ERROR } }, { status: 401 });
}

function verifyAccountTotp(token: string, config: TotpSecretConfig) {
  return [config.current, ...(config.previous ?? [])].some((secretBase32) =>
    verifyTotp({
      token,
      secretBase32,
      period: config.period,
      digits: config.digits,
      window: config.window,
    }),
  );
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { ok: false, error: { code: 'LEGACY_LOGIN_DISABLED', message: 'Use Auth OIDC sign-in.' } },
      { status: 410 },
    );
  }
  try {
    // Per-IP bucket — caps any single (possibly spoofed) X-Forwarded-For.
    const perIpLimiter = await enforceRateLimit(`login:${getClientKey(request)}`, 5, 60_000);
    if (!perIpLimiter.ok) {
      return NextResponse.json(
        { ok: false, error: { message: '登录尝试过多，请稍后再试。' } },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(perIpLimiter.retryAfterMs / 1000)) },
        },
      );
    }

    // Global bucket — defense against header rotation. Even if an attacker
    // varies X-Forwarded-For on every request, they cannot exceed this cap.
    // The threshold is generous enough to allow a few admins on the same
    // egress IP to retry without false positives, but small enough that an
    // online brute force still hits a wall.
    const globalLimiter = await enforceRateLimit('login:global', 30, 60_000);
    if (!globalLimiter.ok) {
      return NextResponse.json(
        { ok: false, error: { message: '登录尝试过多，请稍后再试。' } },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(globalLimiter.retryAfterMs / 1000)) },
        },
      );
    }

    await ensureOwnerBootstrap();
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      totpToken?: string;
    };
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const totpToken = typeof body.totpToken === 'string' ? body.totpToken.trim() : '';

    if (!email || !password || !totpToken) {
      return genericFailure('missing password');
    }

    const account = await getAccountByEmail(email);
    if (
      !account ||
      account.status !== 'active' ||
      (account.role === 'owner' && account.authMethod === 'webauthn') ||
      !verifyPasswordHash(password, account.passwordHash)
    ) {
      return genericFailure('wrong password');
    }
    const totp = JSON.parse(decryptSecret(account.totpEncrypted)) as TotpSecretConfig;
    if (!verifyAccountTotp(totpToken, totp)) {
      return genericFailure('wrong TOTP token');
    }

    const response = NextResponse.json({
      ok: true,
      data: {
        role: account.role,
        authMethod: account.authMethod,
        needsWebAuthnSetup: account.role === 'owner' && account.authMethod !== 'webauthn',
      },
    });
    applyAuthCookies(response, createSession(account, 'password+totp'));
    return response;
  } catch (error) {
    // Log the full reason server-side so operators can still diagnose
    // misconfiguration; never reflect internal hints to the client.
    if (isConfigurationError(error)) {
      console.error('[admin/login] configuration error:', (error as Error).message);
    } else {
      console.error('[admin/login] unexpected error:', error);
    }
    return NextResponse.json(
      { ok: false, error: { message: GENERIC_SERVER_ERROR } },
      { status: 500 },
    );
  }
}
