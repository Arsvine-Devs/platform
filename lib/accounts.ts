import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import { getDb } from './db';
import { accountEvents, invitations, users, workspaceConfigs } from './db/schema';
import { getAdminTotpConfig, type TotpSecretConfig } from './totp';
import { decryptSecret, encryptSecret } from './secrets';
import { resolveXTimelineSyncMethod, type WorkspaceConfig } from './workspace-context';

export type Account = typeof users.$inferSelect;
export type PublicMember = Pick<Account, 'id' | 'email' | 'role' | 'status' | 'createdAt' | 'updatedAt'>;
export type PublicInvitation = Pick<typeof invitations.$inferSelect, 'id' | 'email' | 'status' | 'expiresAt' | 'createdAt'>;

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效的邮箱地址。');
  return email;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

export function hashPassword(password: string) {
  if (password.length < 14) throw new Error('密码至少需要 14 个字符。');
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('base64url')}`;
}

export function verifyPasswordHash(password: string, encoded: string) {
  const match = /^scrypt\$([^$]+)\$([^$]+)$/.exec(encoded);
  if (!match) return false;
  const actual = Buffer.from(scryptSync(password, match[1], 64).toString('base64url'));
  const expected = Buffer.from(match[2]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function legacyWorkspace(): WorkspaceConfig | null {
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  const token = process.env.GITHUB_WRITE_TOKEN?.trim();
  if (!owner || !repo || !token) return null;
  const baseUrl = process.env.AI_TRANSLATION_BASE_URL?.trim();
  const apiKey = process.env.AI_TRANSLATION_API_KEY?.trim();
  return {
    github: { owner, repo, token, branch: process.env.GITHUB_BRANCH?.trim() || 'main' },
    revalidate: {
      contentUrl: process.env.PUBLIC_REVALIDATE_URL?.trim(),
      tweetsUrl: process.env.PUBLIC_TWEETS_REVALIDATE_URL?.trim(),
      secret: process.env.PUBLIC_REVALIDATE_SECRET?.trim(),
    },
    ...(baseUrl && apiKey
      ? { translation: { baseUrl, apiKey, model: process.env.AI_TRANSLATION_MODEL?.trim(), thinking: process.env.AI_TRANSLATION_THINKING?.trim(), reasoningEffort: process.env.AI_TRANSLATION_REASONING_EFFORT?.trim() } }
      : {}),
  };
}

export async function ensureOwnerBootstrap() {
  const db = getDb();
  const [owner] = await db.select().from(users).where(eq(users.role, 'owner')).limit(1);
  if (owner) return owner;

  const email = process.env.OWNER_ADMIN_EMAIL?.trim();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!email || !passwordHash) throw new Error('Missing OWNER_ADMIN_EMAIL or ADMIN_PASSWORD_HASH');
  const totp = getAdminTotpConfig();
  const [created] = await db.insert(users).values({
    email: normalizedEmail(email), role: 'owner', status: 'active', passwordHash,
    totpEncrypted: encryptSecret(JSON.stringify(totp)),
  }).returning();
  const workspace = legacyWorkspace();
  if (workspace) await db.insert(workspaceConfigs).values({ userId: created.id, encryptedConfig: encryptSecret(JSON.stringify(workspace)) });
  await db.insert(accountEvents).values({ actorId: created.id, targetId: created.id, type: 'owner_bootstrapped' });
  return created;
}

export async function getActiveAccount(id: string) {
  const [account] = await getDb().select().from(users).where(and(eq(users.id, id), eq(users.status, 'active'))).limit(1);
  return account ?? null;
}

export async function getAccountById(id: string) {
  const [account] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return account ?? null;
}

export async function getAccountByEmail(email: string) {
  await ensureOwnerBootstrap();
  const [account] = await getDb().select().from(users).where(eq(users.email, normalizedEmail(email))).limit(1);
  return account ?? null;
}

export async function getWorkspaceConfig(userId: string) {
  const [row] = await getDb().select().from(workspaceConfigs).where(eq(workspaceConfigs.userId, userId)).limit(1);
  if (!row) throw new Error('请先在“我的工作区”配置私有仓库。');
  return JSON.parse(decryptSecret(row.encryptedConfig)) as WorkspaceConfig;
}

export async function getWorkspaceSummary(userId: string) {
  const config = await getWorkspaceConfig(userId);
  return {
    github: { owner: config.github.owner, repo: config.github.repo, branch: config.github.branch, hasToken: Boolean(config.github.token) },
    revalidate: { hasContentUrl: Boolean(config.revalidate.contentUrl), hasTweetsUrl: Boolean(config.revalidate.tweetsUrl), hasSecret: Boolean(config.revalidate.secret) },
    translation: config.translation ? { baseUrl: config.translation.baseUrl, model: config.translation.model ?? '', hasApiKey: Boolean(config.translation.apiKey) } : null,
    x: config.x ? {
      syncMethod: resolveXTimelineSyncMethod(config.x),
      targetUserId: config.x.targetUserId,
      targetUsername: config.x.targetUsername,
      hasBearerToken: Boolean(config.x.bearerToken),
      includeReplies: config.x.includeReplies,
      includeRetweets: config.x.includeRetweets,
      lastSyncAt: config.x.sync?.lastSyncAt ?? null,
      hasPendingBackfill: Boolean(config.x.sync?.paginationToken),
    } : null,
  };
}

export async function saveWorkspaceConfig(userId: string, config: WorkspaceConfig) {
  const encryptedConfig = encryptSecret(JSON.stringify(config));
  await getDb().insert(workspaceConfigs).values({ userId, encryptedConfig }).onConflictDoUpdate({ target: workspaceConfigs.userId, set: { encryptedConfig, updatedAt: new Date() } });
}

export async function listActiveWorkspaceConfigs() {
  const activeUsers = await getDb().select({ userId: users.id }).from(users).where(eq(users.status, 'active'));
  const result: Array<{ userId: string; config: WorkspaceConfig }> = [];

  for (const user of activeUsers) {
    try {
      result.push({ userId: user.userId, config: await getWorkspaceConfig(user.userId) });
    } catch (error) {
      console.warn(`[accounts] skipping workspace ${user.userId}:`, error instanceof Error ? error.message : error);
    }
  }

  return result;
}

export async function createInvitation(actorId: string, rawEmail: string) {
  const db = getDb();
  const email = normalizedEmail(rawEmail);
  const existing = await getAccountByEmail(email);
  if (existing) throw new Error('该邮箱已拥有账户。');
  await db.update(invitations).set({ status: 'revoked' }).where(and(eq(invitations.email, email), eq(invitations.status, 'pending')));
  const token = randomBytes(32).toString('base64url');
  const [invite] = await db.insert(invitations).values({ email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS), createdBy: actorId }).returning();
  await db.insert(accountEvents).values({ actorId, type: 'invited_editor' });
  return { id: invite.id, token, expiresAt: invite.expiresAt };
}

export async function listMembers(): Promise<PublicMember[]> {
  return getDb().select({ id: users.id, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).orderBy(asc(users.createdAt));
}

export async function listPendingInvitations(): Promise<PublicInvitation[]> {
  return getDb().select({ id: invitations.id, email: invitations.email, status: invitations.status, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations).where(eq(invitations.status, 'pending')).orderBy(asc(invitations.createdAt));
}

export async function revokeInvitation(actorId: string, invitationId: string) {
  const db = getDb();
  const [invite] = await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!invite || invite.status !== 'pending') throw new Error('邀请不存在或已失效。');
  await db.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, invitationId));
  await db.insert(accountEvents).values({ actorId, type: 'revoked_invitation' });
}

export async function validateInvitation(token: string) {
  const [invite] = await getDb().select().from(invitations).where(and(eq(invitations.tokenHash, sha256(token)), eq(invitations.status, 'pending'), gt(invitations.expiresAt, new Date()))).limit(1);
  return invite ?? null;
}

export async function acceptInvitation(token: string, passwordHash: string, totp: TotpSecretConfig) {
  const invite = await validateInvitation(token);
  if (!invite) throw new Error('邀请链接无效或已过期。');
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
  const encryptedTotp = encryptSecret(JSON.stringify(totp));
  const account = existing
    ? (() => {
        if (existing.role !== 'editor' || existing.status !== 'pending') throw new Error('邀请已失效。');
        return existing;
      })()
    : (await db.insert(users).values({ email: invite.email, role: 'editor', status: 'pending', passwordHash, totpEncrypted: encryptedTotp }).returning())[0];
  if (existing) await db.update(users).set({ passwordHash, totpEncrypted: encryptedTotp, updatedAt: new Date() }).where(eq(users.id, existing.id));
  return { account, invite };
}

export async function activateInvitation(invitationId: string, userId: string) {
  const db = getDb();
  await db.update(users).set({ status: 'active', updatedAt: new Date() }).where(eq(users.id, userId));
  await db.update(invitations).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(invitations.id, invitationId));
  await db.insert(accountEvents).values({ targetId: userId, type: 'accepted_invitation' });
}

export async function setMemberStatus(actorId: string, userId: string, status: 'active' | 'disabled') {
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target || target.role === 'owner') throw new Error('唯一管理员账户不能被修改。');
  await db.update(users).set({ status, sessionVersion: target.sessionVersion + 1, updatedAt: new Date() }).where(eq(users.id, userId));
  if (status === 'disabled') await db.delete(workspaceConfigs).where(eq(workspaceConfigs.userId, userId));
  await db.insert(accountEvents).values({ actorId, targetId: userId, type: status === 'disabled' ? 'disabled_member' : 'enabled_member' });
}
