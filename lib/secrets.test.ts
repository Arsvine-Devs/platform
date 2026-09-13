import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from './secrets';

beforeEach(() =>
  vi.stubEnv('WORKSPACE_SECRETS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url')),
);
afterEach(() => vi.unstubAllEnvs());

describe('workspace secret encryption', () => {
  it('round-trips AES-GCM ciphertext without leaving plaintext in the payload', () => {
    const encrypted = encryptSecret('github_pat_private_value');
    expect(encrypted).not.toContain('github_pat_private_value');
    expect(decryptSecret(encrypted)).toBe('github_pat_private_value');
  });

  it('rejects a modified ciphertext', () => {
    const encrypted = encryptSecret('private');
    expect(() => decryptSecret(`${encrypted}x`)).toThrow();
  });
});
