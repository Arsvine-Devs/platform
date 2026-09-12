import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticationOptions,
  createRegistrationOptions,
  getWebAuthnConfig,
  isAuthenticationResponse,
  isHardwareOrientedCredential,
  isRecentWebAuthnSession,
  isRegistrationResponse,
  normalizeCredentialLabel,
  webAuthnUserId,
} from './webauthn';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('WEBAUTHN_RP_ID', 'ctrl.arsvine.com');
  vi.stubEnv('WEBAUTHN_ORIGIN', 'https://ctrl.arsvine.com');
  vi.stubEnv('WEBAUTHN_RP_NAME', 'ARSVINE Admin');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('WebAuthn configuration', () => {
  it('returns a normalized fixed RP configuration', () => {
    expect(getWebAuthnConfig()).toEqual({
      rpId: 'ctrl.arsvine.com',
      origin: 'https://ctrl.arsvine.com',
      rpName: 'ARSVINE Admin',
    });
  });

  it('rejects an origin with a path or an RP ID outside the origin', () => {
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://ctrl.arsvine.com/admin');
    expect(() => getWebAuthnConfig()).toThrow(/must not include a path/);

    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://example.com');
    expect(() => getWebAuthnConfig()).toThrow(/registrable suffix/);

    vi.stubEnv('WEBAUTHN_RP_ID', 'https://ctrl.arsvine.com');
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://ctrl.arsvine.com');
    expect(() => getWebAuthnConfig()).toThrow(/valid domain name/);
  });

  it('requires HTTPS for production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEBAUTHN_ORIGIN', 'http://ctrl.arsvine.com');
    expect(() => getWebAuthnConfig()).toThrow(/HTTPS/);
  });
});

describe('WebAuthn options', () => {
  it('creates security-key registration options with resident keys and UV', async () => {
    const options = await createRegistrationOptions({ id: OWNER_ID, email: 'owner@example.com' }, []);
    expect(options.rp).toEqual({ name: 'ARSVINE Admin', id: 'ctrl.arsvine.com' });
    expect(options.attestation).toBe('direct');
    expect(options.hints).toEqual(['security-key']);
    expect(options.authenticatorSelection).toMatchObject({
      authenticatorAttachment: 'cross-platform',
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    });
    expect(options.user.id).toBe(Buffer.from(webAuthnUserId(OWNER_ID)).toString('base64url'));
  });

  it('creates authentication options only for stored credentials', async () => {
    const options = await createAuthenticationOptions([{
      id: 'credential-record-id',
      credentialId: 'credential-id',
      publicKey: 'public-key',
      counter: 0,
      transports: ['usb'],
    }]);
    expect(options.rpId).toBe('ctrl.arsvine.com');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials).toEqual([{ id: 'credential-id', type: 'public-key', transports: ['usb'] }]);
  });
});

describe('WebAuthn policy helpers', () => {
  it('accepts only single-device non-backed-up credentials', () => {
    expect(isHardwareOrientedCredential('singleDevice', false)).toBe(true);
    expect(isHardwareOrientedCredential('multiDevice', false)).toBe(false);
    expect(isHardwareOrientedCredential('singleDevice', true)).toBe(false);
  });

  it('requires a recent WebAuthn session for credential management', () => {
    const now = 1_000_000;
    const session = { amr: 'webauthn' as const, authAt: now - 60_000 } as never;
    expect(isRecentWebAuthnSession(session, now)).toBe(true);
    expect(isRecentWebAuthnSession({ amr: 'webauthn', authAt: now - 11 * 60_000 } as never, now)).toBe(false);
    expect(isRecentWebAuthnSession({ amr: 'password+totp', authAt: now } as never, now)).toBe(false);
  });

  it('validates labels and the JSON response envelope', () => {
    expect(normalizeCredentialLabel('日常 YubiKey')).toBe('日常 YubiKey');
    expect(() => normalizeCredentialLabel('')).toThrow();
    expect(() => normalizeCredentialLabel(`a${'x'.repeat(64)}`)).toThrow();

    const authentication = {
      id: 'credential-id',
      rawId: 'credential-id',
      type: 'public-key',
      response: {
        clientDataJSON: 'client-data',
        authenticatorData: 'authenticator-data',
        signature: 'signature',
      },
      clientExtensionResults: {},
    };
    expect(isAuthenticationResponse(authentication)).toBe(true);
    expect(isAuthenticationResponse({ ...authentication, rawId: 'other' })).toBe(false);
    expect(isRegistrationResponse({
      id: 'credential-id',
      rawId: 'credential-id',
      type: 'public-key',
      response: { clientDataJSON: 'client-data', attestationObject: 'attestation-object' },
      clientExtensionResults: {},
    })).toBe(true);
  });
});
