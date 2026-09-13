import { createHmac, timingSafeEqual } from 'node:crypto';

type Activation = { invitationId: string; userId: string; exp: number; sig: string };

function secret() {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value) throw new Error('Missing SESSION_SECRET');
  return value;
}

function sign(value: Omit<Activation, 'sig'>) {
  return createHmac('sha256', secret())
    .update(`${value.invitationId}:${value.userId}:${value.exp}`)
    .digest('base64url');
}

export function createActivationToken(invitationId: string, userId: string) {
  const data = { invitationId, userId, exp: Date.now() + 15 * 60 * 1000 };
  return Buffer.from(JSON.stringify({ ...data, sig: sign(data) }), 'utf8').toString('base64url');
}

export function readActivationToken(value?: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value ?? '', 'base64url').toString('utf8')) as Activation;
    const expected = Buffer.from(sign(parsed));
    const actual = Buffer.from(parsed.sig);
    if (
      parsed.exp <= Date.now() ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
