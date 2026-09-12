import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createTotpUri, getAdminTotpConfig, verifyAdminTotpToken, verifyTotp } from './totp';

const FIXED_SECRET = 'JBSWY3DPEHPK3PXP';
const ORIGINAL_NOW = Date.now;
let mockedNow = 0;

beforeEach(() => {
  mockedNow = 1735732800 * 1000;
  Date.now = () => mockedNow;
  // `vi.stubEnv` writes through Next.js' readonly NODE_ENV typing; pair with
  // `vi.unstubAllEnvs()` in afterEach for automatic restoration.
  vi.stubEnv('ADMIN_TOTP_JSON', '');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  Date.now = ORIGINAL_NOW;
  vi.unstubAllEnvs();
});

function setAdminTotp(config: Record<string, unknown>) {
  vi.stubEnv('ADMIN_TOTP_JSON', JSON.stringify(config));
}

describe('verifyTotp', () => {
  it('accepts the current-step code', () => {
    const period = 30;
    const code = computeCodeForStep(FIXED_SECRET, BigInt(Math.floor(mockedNow / 1000 / period)), 6);
    expect(verifyTotp({ token: code, secretBase32: FIXED_SECRET, period, digits: 6, window: 0, nowMs: mockedNow })).toBe(true);
  });

  it('rejects a token outside the allowed window', () => {
    const period = 30;
    const code = computeCodeForStep(FIXED_SECRET, BigInt(Math.floor(mockedNow / 1000 / period)) + BigInt(4), 6);
    expect(verifyTotp({ token: code, secretBase32: FIXED_SECRET, period, digits: 6, window: 1, nowMs: mockedNow })).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifyTotp({ token: '12345', secretBase32: FIXED_SECRET, nowMs: mockedNow })).toBe(false);
    expect(verifyTotp({ token: 'abcdef', secretBase32: FIXED_SECRET, nowMs: mockedNow })).toBe(false);
  });
});

describe('createTotpUri', () => {
  it('creates a standard TOTP URI with an encoded label and explicit parameters', () => {
    expect(createTotpUri({ email: 'Editor+one@example.com', secret: FIXED_SECRET })).toBe(
      'otpauth://totp/ARSVINE%20Admin%3Aeditor%2Bone%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ARSVINE+Admin&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('admin TOTP config', () => {
  it('parses a valid ADMIN_TOTP_JSON payload', () => {
    setAdminTotp({ current: FIXED_SECRET, period: 30, digits: 6, window: 1 });
    expect(getAdminTotpConfig()).toEqual({
      current: FIXED_SECRET,
      period: 30,
      digits: 6,
      window: 1,
    });
  });

  it('accepts previous secrets during rotation', () => {
    const previousSecret = 'KRSXG5BAONSWG4TFOQ';
    const code = computeCodeForStep(previousSecret, BigInt(Math.floor(mockedNow / 1000 / 30)), 6);
    setAdminTotp({ current: FIXED_SECRET, previous: [previousSecret], period: 30, digits: 6, window: 1 });
    expect(verifyAdminTotpToken(code)).toBe(true);
  });

  it('throws on invalid JSON', () => {
    vi.stubEnv('ADMIN_TOTP_JSON', '{not-json');
    expect(() => getAdminTotpConfig()).toThrow(/Invalid ADMIN_TOTP_JSON/);
  });
});

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/[\s-]/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function computeCodeForStep(secretBase32: string, counter: bigint, digits: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const secret = base32Decode(secretBase32);
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
