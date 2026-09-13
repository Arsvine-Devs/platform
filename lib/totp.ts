import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TotpSecretConfig = {
  current: string;
  previous?: string[];
  period?: number;
  digits?: number;
  window?: number;
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(byteLength = 20) {
  const bytes = randomBytes(byteLength);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    const group = bits.slice(offset, offset + 5).padEnd(5, '0');
    result += BASE32_ALPHABET[Number.parseInt(group, 2)];
  }
  return result;
}

export function createTotpUri(params: {
  email: string;
  secret: string;
  issuer?: string;
  period?: number;
  digits?: number;
}) {
  const issuer = params.issuer ?? 'ARSVINE Admin';
  const label = `${issuer}:${params.email.trim().toLowerCase()}`;
  const search = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(params.digits ?? 6),
    period: String(params.period ?? 30),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${search.toString()}`;
}

function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/[\s-]/g, '');
  let bits = '';

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 secret.');
    }
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: bigint, digits: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    10 ** digits;

  return code.toString().padStart(digits, '0');
}

function parseAdminTotpConfig(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid ADMIN_TOTP_JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ADMIN_TOTP_JSON must be a plain object.');
  }

  const config = parsed as TotpSecretConfig;
  if (!config.current || typeof config.current !== 'string') {
    throw new Error('ADMIN_TOTP_JSON.current is required.');
  }

  if (config.previous && !Array.isArray(config.previous)) {
    throw new Error('ADMIN_TOTP_JSON.previous must be an array when provided.');
  }

  return config;
}

export function verifyTotp(opts: {
  token: string;
  secretBase32: string;
  period?: number;
  digits?: number;
  window?: number;
  nowMs?: number;
}) {
  const { token, secretBase32, period = 30, digits = 6, window = 1, nowMs = Date.now() } = opts;

  if (!/^\d+$/.test(token) || token.length !== digits) return false;

  const secret = base32Decode(secretBase32);
  const step = BigInt(Math.floor(nowMs / 1000 / period));
  const expected = Buffer.from(token);

  for (let offset = -window; offset <= window; offset += 1) {
    const generated = Buffer.from(hotp(secret, step + BigInt(offset), digits));
    if (generated.length === expected.length && timingSafeEqual(generated, expected)) {
      return true;
    }
  }

  return false;
}

export function getAdminTotpConfig() {
  const raw = process.env.ADMIN_TOTP_JSON?.trim();
  if (!raw) {
    throw new Error('Missing ADMIN_TOTP_JSON');
  }

  return parseAdminTotpConfig(raw);
}

export function verifyAdminTotpToken(token: string) {
  const config = getAdminTotpConfig();

  if (
    verifyTotp({
      token,
      secretBase32: config.current,
      period: config.period,
      digits: config.digits,
      window: config.window,
    })
  ) {
    return true;
  }

  for (const previous of config.previous ?? []) {
    if (
      verifyTotp({
        token,
        secretBase32: previous,
        period: config.period,
        digits: config.digits,
        window: config.window,
      })
    ) {
      return true;
    }
  }

  return false;
}
