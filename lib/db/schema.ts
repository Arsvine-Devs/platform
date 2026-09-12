import { sql } from 'drizzle-orm';
import { bigint, boolean, integer, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['owner', 'editor']);
export const userStatus = pgEnum('user_status', ['pending', 'active', 'disabled']);
export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'revoked']);
export const authMethod = pgEnum('auth_method', ['password+totp', 'webauthn']);
export const webauthnChallengeType = pgEnum('webauthn_challenge_type', ['authentication', 'registration']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  role: userRole('role').notNull(),
  status: userStatus('status').notNull().default('pending'),
  authMethod: authMethod('auth_method').notNull().default('password+totp'),
  passwordHash: text('password_hash').notNull(),
  totpEncrypted: text('totp_encrypted').notNull(),
  sessionVersion: integer('session_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_single_owner_idx')
    .on(table.role)
    .where(sql`${table.role} = 'owner'`),
]);

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  label: text('label').notNull(),
  aaguid: text('aaguid').notNull(),
  attestationFormat: text('attestation_format').notNull(),
  transports: text('transports').notNull().default('[]'),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('webauthn_credentials_user_idx').on(table.userId),
  index('webauthn_credentials_active_idx').on(table.userId, table.revokedAt),
]);

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: webauthnChallengeType('type').notNull(),
  challenge: text('challenge').notNull().unique(),
  rpId: text('rp_id').notNull(),
  origin: text('origin').notNull(),
  label: text('label'),
  sessionBindingHash: text('session_binding_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('webauthn_challenges_lookup_idx').on(table.id, table.userId, table.type),
  index('webauthn_challenges_expiry_idx').on(table.expiresAt),
]);

export const workspaceConfigs = pgTable('workspace_configs', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  encryptedConfig: text('encrypted_config').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  status: invitationStatus('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountEvents = pgTable('account_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  targetId: uuid('target_id').references(() => users.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
