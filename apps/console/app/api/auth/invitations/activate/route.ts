import { NextResponse, type NextRequest } from 'next/server';
import {
  acceptInvitation,
  activateInvitation,
  getAccountById,
  hashPassword,
} from '../../../../../lib/accounts';
import { createActivationToken, readActivationToken } from '../../../../../lib/activation';
import { applyAuthCookies, createSession } from '../../../../../lib/auth';
import { decryptSecret } from '../../../../../lib/secrets';
import {
  createTotpUri,
  generateTotpSecret,
  verifyTotp,
  type TotpSecretConfig,
} from '../../../../../lib/totp';
import { getClientKey } from '../../../../../lib/client-key';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { privateJson } from '../../../../../lib/private-response';

const ACTIVATION_COOKIE = 'arsvine_invitation_activation';

export async function POST(request: NextRequest) {
  const limiter = await enforceRateLimit(
    `invitation-activation:${getClientKey(request)}`,
    12,
    15 * 60_000,
  );
  if (!limiter.ok) {
    return NextResponse.json(
      { ok: false, error: { message: '操作过于频繁，请稍后再试。' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limiter.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as {
      phase?: 'start' | 'verify';
      token?: string;
      password?: string;
      totpToken?: string;
    };
    if (body.phase === 'start') {
      if (!body.token || !body.password) throw new Error('邀请链接或密码无效。');
      const totp: TotpSecretConfig = {
        current: generateTotpSecret(),
        period: 30,
        digits: 6,
        window: 1,
      };
      const { account, invite } = await acceptInvitation(
        body.token,
        hashPassword(body.password),
        totp,
      );
      const response = privateJson({
        ok: true,
        data: {
          email: account.email,
          totpSecret: totp.current,
          totpUri: createTotpUri({
            email: account.email,
            secret: totp.current,
            period: totp.period,
            digits: totp.digits,
          }),
        },
      });
      response.cookies.set(ACTIVATION_COOKIE, createActivationToken(invite.id, account.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth/invitations/activate',
        maxAge: 15 * 60,
      });
      return response;
    }
    if (body.phase === 'verify') {
      const activation = readActivationToken(request.cookies.get(ACTIVATION_COOKIE)?.value);
      if (!activation || !body.totpToken) throw new Error('激活会话已失效，请重新打开邀请链接。');
      const account = await getAccountById(activation.userId);
      if (!account || account.status !== 'pending') throw new Error('邀请已失效。');
      const totp = JSON.parse(decryptSecret(account.totpEncrypted)) as TotpSecretConfig;
      if (
        !verifyTotp({
          token: body.totpToken,
          secretBase32: totp.current,
          period: totp.period,
          digits: totp.digits,
          window: totp.window,
        })
      )
        throw new Error('验证码不正确。');
      await activateInvitation(activation.invitationId, account.id);
      const response = privateJson({ ok: true });
      response.cookies.set(ACTIVATION_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth/invitations/activate',
        maxAge: 0,
      });
      applyAuthCookies(
        response,
        createSession({
          id: account.id,
          role: account.role,
          sessionVersion: account.sessionVersion,
        }),
      );
      return response;
    }
    throw new Error('无效的激活请求。');
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { message: error instanceof Error ? error.message : '激活失败。' } },
      { status: 422 },
    );
  }
}
