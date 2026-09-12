import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { WebAuthnCredential } from '@simplewebauthn/server';

import { getDb } from './db';
import { accountEvents, users, webauthnChallenges, webauthnCredentials } from './db/schema';
import { parseCredentialTransports, serializeCredentialTransports, type StoredWebAuthnCredential } from './webauthn';

export type WebAuthnChallengeType = 'authentication' | 'registration';

export async function getOwnerAccount() {
  const [owner] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.role, 'owner'), eq(users.status, 'active')))
    .limit(1);
  return owner ?? null;
}

export async function listActiveWebAuthnCredentials(userId: string) {
  return getDb()
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), isNull(webauthnCredentials.revokedAt)))
    .orderBy(asc(webauthnCredentials.createdAt));
}

export async function getActiveWebAuthnCredential(userId: string, credentialId: string) {
  const [credential] = await getDb()
    .select()
    .from(webauthnCredentials)
    .where(and(
      eq(webauthnCredentials.userId, userId),
      eq(webauthnCredentials.credentialId, credentialId),
      isNull(webauthnCredentials.revokedAt),
    ))
    .limit(1);
  return credential ?? null;
}

export async function createWebAuthnChallenge(input: {
  userId: string;
  type: WebAuthnChallengeType;
  challenge: string;
  rpId: string;
  origin: string;
  expiresAt: Date;
  label?: string;
  sessionBindingHash?: string;
}) {
  const db = getDb();
  await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date()));
  const [challenge] = await db.insert(webauthnChallenges).values({
    userId: input.userId,
    type: input.type,
    challenge: input.challenge,
    rpId: input.rpId,
    origin: input.origin,
    expiresAt: input.expiresAt,
    label: input.label,
    sessionBindingHash: input.sessionBindingHash,
  }).returning();
  return challenge;
}

export async function consumeWebAuthnChallenge(input: {
  id: string;
  userId: string;
  type: WebAuthnChallengeType;
}) {
  const [challenge] = await getDb()
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(webauthnChallenges.id, input.id),
      eq(webauthnChallenges.userId, input.userId),
      eq(webauthnChallenges.type, input.type),
      isNull(webauthnChallenges.consumedAt),
      gt(webauthnChallenges.expiresAt, new Date()),
    ))
    .returning();
  return challenge ?? null;
}

export async function saveWebAuthnCredential(input: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  label: string;
  aaguid: string;
  attestationFormat: string;
  transports: unknown;
  deviceType: string;
  backedUp: boolean;
}) {
  const [credential] = await getDb().insert(webauthnCredentials).values({
    userId: input.userId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    counter: input.counter,
    label: input.label,
    aaguid: input.aaguid,
    attestationFormat: input.attestationFormat,
    transports: serializeCredentialTransports(input.transports),
    deviceType: input.deviceType,
    backedUp: input.backedUp,
  }).returning();
  return credential;
}

export function toStoredWebAuthnCredential(credential: {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string;
}): StoredWebAuthnCredential {
  return {
    id: credential.id,
    credentialId: credential.credentialId,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: parseCredentialTransports(credential.transports),
  };
}

export function toWebAuthnVerificationCredential(credential: {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string;
}): WebAuthnCredential {
  return {
    id: credential.credentialId,
    publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
    counter: credential.counter,
    transports: parseCredentialTransports(credential.transports),
  };
}

export async function updateWebAuthnCredentialAfterAuthentication(input: {
  userId: string;
  credentialId: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
}) {
  const [credential] = await getDb()
    .update(webauthnCredentials)
    .set({
      counter: sql`GREATEST(${webauthnCredentials.counter}, ${input.counter})`,
      deviceType: input.deviceType,
      backedUp: input.backedUp,
      lastUsedAt: new Date(),
    })
    .where(and(
      eq(webauthnCredentials.userId, input.userId),
      eq(webauthnCredentials.credentialId, input.credentialId),
      isNull(webauthnCredentials.revokedAt),
    ))
    .returning();
  return credential ?? null;
}

export async function enableOwnerWebAuthn(userId: string, expectedSessionVersion: number) {
  const [owner] = await getDb()
    .update(users)
    .set({
      authMethod: 'webauthn',
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(users.id, userId),
      eq(users.role, 'owner'),
      eq(users.status, 'active'),
      eq(users.authMethod, 'password+totp'),
      eq(users.sessionVersion, expectedSessionVersion),
    ))
    .returning();
  return owner ?? null;
}

export async function revokeWebAuthnCredential(userId: string, credentialRecordId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentialRecordId)) {
    throw new Error('安全密钥不存在或已撤销。');
  }

  const now = new Date();
  const result = await getDb().execute(sql`
    WITH locked_owner AS MATERIALIZED (
      SELECT id
      FROM "users"
      WHERE id = ${userId}::uuid AND role = 'owner' AND status = 'active'
      FOR UPDATE
    ),
    locked_credentials AS MATERIALIZED (
      SELECT credential.id, credential.revoked_at
      FROM "webauthn_credentials" AS credential
      JOIN locked_owner ON locked_owner.id = credential.user_id
      FOR UPDATE OF credential
    ),
    active_count AS MATERIALIZED (
      SELECT COUNT(*)::int AS active_count_value
      FROM locked_credentials
      WHERE revoked_at IS NULL
    ),
    revoked AS (
      UPDATE "webauthn_credentials" AS credential
      SET revoked_at = ${now}
      WHERE credential.id = ${credentialRecordId}::uuid
        AND credential.user_id IN (SELECT id FROM locked_owner)
        AND credential.revoked_at IS NULL
        AND (SELECT active_count_value FROM active_count) > 1
      RETURNING credential.id
    )
    UPDATE "users" AS owner
    SET session_version = owner.session_version + 1, updated_at = ${now}
    WHERE owner.id IN (SELECT id FROM locked_owner)
      AND EXISTS (SELECT 1 FROM revoked)
    RETURNING (SELECT id FROM revoked) AS revoked_id
  `);
  if (!result.rows?.length) {
    const active = await listActiveWebAuthnCredentials(userId);
    if (active.length <= 1) throw new Error('至少保留一枚安全密钥。');
    throw new Error('安全密钥不存在或已撤销。');
  }

  try {
    await getDb().insert(accountEvents).values({ actorId: userId, targetId: userId, type: 'revoked_webauthn_credential' });
  } catch (error) {
    console.error('[webauthn] failed to record credential revocation:', error instanceof Error ? error.message : error);
  }
  return { id: credentialRecordId };
}

export async function recordWebAuthnEvent(userId: string, type: string) {
  try {
    await getDb().insert(accountEvents).values({ actorId: userId, targetId: userId, type });
  } catch (error) {
    console.error(`[webauthn] failed to record ${type}:`, error instanceof Error ? error.message : error);
  }
}
