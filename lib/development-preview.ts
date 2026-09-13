import { randomUUID } from 'node:crypto';

import type {
  BlogIndexData,
  BlogIndexItem,
  BlogPublishBatchInput,
  BlogPublishInput,
  BlogPublishResponse,
  BlogTranslateInput,
  BlogTranslateResponse,
  BlogVariantData,
  Invitation,
  InviteData,
  LibraryData,
  Member,
  MembersData,
  SecurityCredential,
  SecurityData,
  WorkspaceSummary,
  WorkspaceUpdateInput,
  WorkspaceVerifyData,
  XSyncData,
} from './admin-api/contracts';
import { BLOG_LOCALES } from './admin-api/contracts';
import {
  type CreateTweetInput,
  type RepoSummary,
  type TweetItem,
  type TweetMonthRecord,
  type TweetTranslation,
  type TweetsDashboardData,
  type UpdateTweetInput,
} from './tweets-types';
import type { WorkspaceConfig } from './workspace-context';

export const DEVELOPMENT_USER_ID = '00000000-0000-4000-8000-000000000099';
export const DEVELOPMENT_EMAIL = 'preview@localhost';

export function isDevelopmentBypassEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.ADMIN_DEV_LOGIN_BYPASS === '1';
}

export function isDevelopmentBypassSession(session: { userId?: string; developmentBypass?: boolean } | null | undefined) {
  return Boolean(session?.developmentBypass && session.userId === DEVELOPMENT_USER_ID && isDevelopmentBypassEnabled());
}

const DEV_NOW = '2026-09-13T09:00:00.000Z';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const developmentWorkspaceConfig: WorkspaceConfig = {
  github: {
    owner: 'local-preview',
    repo: 'arsvine-content-preview',
    branch: 'main',
    token: 'development-only-token',
  },
  revalidate: {
    contentUrl: 'http://localhost:3000/local/revalidate-content',
    tweetsUrl: 'http://localhost:3000/local/revalidate-tweets',
    secret: 'development-only-secret',
  },
  translation: {
    baseUrl: 'local://translation-preview',
    apiKey: 'development-only-key',
    model: 'local-preview-model',
  },
  x: {
    syncMethod: 'api',
    bearerToken: 'development-only-bearer',
    targetUserId: '2244994945',
    targetUsername: 'Arsvine',
    includeReplies: true,
    includeRetweets: false,
    sync: { lastSyncAt: DEV_NOW },
  },
};

export function getDevelopmentWorkspaceConfig() {
  return clone(developmentWorkspaceConfig);
}

const developmentWorkspaceSummary: WorkspaceSummary = {
  github: { owner: developmentWorkspaceConfig.github.owner, repo: developmentWorkspaceConfig.github.repo, branch: 'main', hasToken: true },
  revalidate: { contentUrl: 'http://localhost:3000/local/revalidate-content', tweetsUrl: 'http://localhost:3000/local/revalidate-tweets', hasContentUrl: true, hasTweetsUrl: true, hasSecret: true },
  translation: { baseUrl: 'local://translation-preview', model: 'local-preview-model', hasApiKey: true },
  x: { syncMethod: 'api', targetUserId: '2244994945', targetUsername: 'Arsvine', hasBearerToken: true, includeReplies: true, includeRetweets: false, lastSyncAt: DEV_NOW, hasPendingBackfill: false },
};

export function getDevelopmentWorkspaceSummary(): WorkspaceSummary {
  return clone(developmentWorkspaceSummary);
}

export function updateDevelopmentWorkspace(input: WorkspaceUpdateInput): WorkspaceSummary {
  if (input.github) {
    developmentWorkspaceSummary.github = {
      ...developmentWorkspaceSummary.github,
      ...(input.github.owner?.trim() ? { owner: input.github.owner.trim() } : {}),
      ...(input.github.repo?.trim() ? { repo: input.github.repo.trim() } : {}),
      ...(input.github.branch?.trim() ? { branch: input.github.branch.trim() } : {}),
      ...(input.github.token?.trim() ? { hasToken: true } : {}),
    };
  }

  if (input.revalidate) {
    developmentWorkspaceSummary.revalidate = {
      ...developmentWorkspaceSummary.revalidate,
      ...(input.revalidate.contentUrl?.trim() ? { contentUrl: input.revalidate.contentUrl.trim() } : {}),
      ...(input.revalidate.tweetsUrl?.trim() ? { tweetsUrl: input.revalidate.tweetsUrl.trim() } : {}),
      ...(input.revalidate.contentUrl?.trim() ? { hasContentUrl: true } : {}),
      ...(input.revalidate.tweetsUrl?.trim() ? { hasTweetsUrl: true } : {}),
      ...(input.revalidate.secret?.trim() ? { hasSecret: true } : {}),
    };
  }

  if (input.translation?.baseUrl?.trim()) {
    developmentWorkspaceSummary.translation = {
      baseUrl: input.translation.baseUrl.trim(),
      model: input.translation.model?.trim() ?? developmentWorkspaceSummary.translation?.model ?? '',
      hasApiKey: Boolean(input.translation.apiKey?.trim()) || Boolean(developmentWorkspaceSummary.translation?.hasApiKey),
    };
  }

  if (input.x === null) {
    developmentWorkspaceSummary.x = null;
  } else if (input.x) {
    const previous = developmentWorkspaceSummary.x;
    const targetUserId = input.x.targetUserId?.trim() || previous?.targetUserId || '';
    const targetUsername = input.x.targetUsername?.trim() || previous?.targetUsername || '';
    const syncMethod = input.x.syncMethod ?? previous?.syncMethod ?? 'none';
    developmentWorkspaceSummary.x = {
      syncMethod,
      targetUserId,
      targetUsername,
      hasBearerToken: Boolean(input.x.bearerToken?.trim()) || Boolean(previous?.hasBearerToken),
      includeReplies: input.x.includeReplies ?? previous?.includeReplies ?? true,
      includeRetweets: input.x.includeRetweets ?? previous?.includeRetweets ?? false,
      lastSyncAt: previous?.lastSyncAt ?? null,
      hasPendingBackfill: previous?.hasPendingBackfill ?? false,
    };
  }

  return getDevelopmentWorkspaceSummary();
}

export function verifyDevelopmentRepository(): WorkspaceVerifyData {
  return { repository: { owner: developmentWorkspaceSummary.github.owner, repo: developmentWorkspaceSummary.github.repo } };
}

const developmentBlogVariants = new Map<string, BlogVariantData>([
  ['welcome:zh-CN', { slug: 'welcome', locale: 'zh-CN', title: '欢迎来到本地预览', excerpt: '用于检查管理面板布局和编辑流程的本地文章。', date: '2026-09-13', tags: ['preview', 'admin'], pinned: true, accessMode: 'public', accessGroup: '', originLocale: '', content: '# 欢迎\n\n这是开发期本地预览文章。你可以安全地编辑它，所有改动只存在于当前进程。' }],
  ['welcome:en', { slug: 'welcome', locale: 'en', title: 'Welcome to the local preview', excerpt: 'A local article for checking the admin editor flow.', date: '2026-09-13', tags: ['preview', 'admin'], pinned: true, accessMode: 'public', accessGroup: '', originLocale: 'zh-CN', content: '# Welcome\n\nThis is a local preview article. Changes stay in the current process.' }],
  ['notes:zh-CN', { slug: 'notes', locale: 'zh-CN', title: '私密笔记预览', excerpt: '检查受保护文章元数据和语言变体。', date: '2026-09-05', tags: ['notes'], pinned: false, accessMode: 'totp', accessGroup: 'friends-a', originLocale: '', content: '<Lead>一段本地的导语。</Lead>\n\n<Explain note="只用于检查 MDX 编辑器">受保护内容</Explain>。\n\n<Spoiler>预览剧透内容</Spoiler>' }],
]);

function blogIndexFromVariants(): BlogIndexData {
  const grouped = new Map<string, BlogVariantData[]>();
  for (const variant of developmentBlogVariants.values()) {
    const list = grouped.get(variant.slug) ?? [];
    list.push(variant);
    grouped.set(variant.slug, list);
  }

  const posts: BlogIndexItem[] = [...grouped.values()].map((variants) => {
    const preferred = variants.find((variant) => variant.locale === 'zh-CN') ?? variants.find((variant) => variant.locale === 'en') ?? variants[0];
    const availableLocales = variants.map((variant) => variant.locale).sort((left, right) => BLOG_LOCALES.indexOf(left) - BLOG_LOCALES.indexOf(right));
    return {
      slug: preferred.slug,
      date: preferred.date,
      updatedAt: DEV_NOW,
      tags: preferred.tags,
      pinned: preferred.pinned,
      access: preferred.accessMode === 'totp' ? { mode: 'totp', group: preferred.accessGroup } : { mode: 'public' },
      availableLocales,
      variants: Object.fromEntries(variants.map((variant) => [variant.locale, { title: variant.title, excerpt: variant.excerpt, tags: variant.tags, ...(variant.originLocale ? { originLocale: variant.originLocale } : {}) }])) as BlogIndexItem['variants'],
    };
  });

  posts.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.date.localeCompare(left.date));
  return { version: 1, updatedAt: DEV_NOW, posts };
}

export function getDevelopmentBlogIndex() {
  return clone(blogIndexFromVariants());
}

export function getDevelopmentLibraryData(): LibraryData {
  const blog = getDevelopmentBlogIndex();
  const tweets = getDevelopmentTweetsData();
  return {
    items: [
      ...blog.posts.map((post) => ({
        id: `blog:${post.slug}`,
        type: 'blog' as const,
        title: post.variants['zh-CN']?.title || post.variants.en?.title || post.slug,
        locale: post.availableLocales.join(' · '),
        status: 'published' as const,
        updatedAt: post.updatedAt,
        href: `/blog?slug=${encodeURIComponent(post.slug)}&locale=${encodeURIComponent(post.availableLocales[0] ?? 'zh-CN')}`,
      })),
      ...tweets.months.flatMap((month) => month.tweets.map((tweet) => ({
        id: `tweet:${tweet.id}`,
        type: 'tweet' as const,
        title: tweet.content.replace(/\s+/g, ' ').slice(0, 90) || tweet.id,
        locale: tweet.lang || 'other',
        status: tweet.visibility === 'hidden' ? 'draft' as const : 'published' as const,
        updatedAt: tweet.updatedAt || tweet.createdAt,
        href: `/tweets?month=${encodeURIComponent(month.month)}&id=${encodeURIComponent(tweet.id)}`,
      }))),
    ].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
  };
}

export function getDevelopmentBlogVariant(slug: string, locale: string) {
  return clone(developmentBlogVariants.get(`${slug.trim().toLowerCase()}:${locale}`) ?? null);
}

function revalidationPreview() {
  return { revalidated: false, paths: [], error: 'Development preview: remote revalidation skipped.' };
}

export function publishDevelopmentPost(input: BlogPublishInput): BlogPublishResponse {
  const slug = input.slug.trim().toLowerCase();
  developmentBlogVariants.set(`${slug}:${input.locale}`, {
    slug,
    locale: input.locale,
    title: input.title,
    excerpt: input.excerpt,
    date: input.date,
    tags: input.tags,
    pinned: input.pinned,
    accessMode: input.accessMode,
    accessGroup: input.accessGroup ?? '',
    originLocale: input.originLocale ?? '',
    content: input.content,
  });
  return { path: `blog/${slug}/${input.locale}.mdx`, commits: [], revalidated: revalidationPreview() };
}

export function publishDevelopmentBatch(input: BlogPublishBatchInput): BlogPublishResponse {
  const paths = input.variants.map((variant) => {
    publishDevelopmentPost({ ...input, ...variant, locale: variant.locale });
    return `blog/${input.slug.trim().toLowerCase()}/${variant.locale}.mdx`;
  });
  return { paths, commits: [], revalidated: revalidationPreview() };
}

export function rebuildDevelopmentBlogIndex() {
  return { index: getDevelopmentBlogIndex(), revalidated: revalidationPreview() };
}

export function translateDevelopmentBlog(input: BlogTranslateInput): BlogTranslateResponse {
  return {
    variants: (input.targetLocales ?? ['zh-TW', 'en']).map((locale) => ({
      locale,
      title: `[${locale} preview] ${input.title}`,
      excerpt: input.excerpt,
      tags: input.tags,
      content: input.content,
      originLocale: input.sourceLocale,
    })),
  };
}

const developmentRepo: RepoSummary = {
  name: 'local-preview/arsvine-content',
  branch: 'main',
  originUrl: 'local://arsvine-content-preview',
  hasChanges: false,
  changedFilesCount: 0,
  hasRemote: false,
  aheadCount: 0,
  behindCount: 0,
};

let developmentTweets: TweetMonthRecord[] = [
  {
    month: '2026-09',
    path: 'tweets/2026-09.json',
    count: 2,
    updatedAt: DEV_NOW,
    tweets: [
      { id: '20260913-001', createdAt: '2026-09-13T08:00:00+08:00', updatedAt: DEV_NOW, content: '本地预览推文，用于检查列表、编辑和译文状态。', lang: 'zh-CN', tags: ['preview'], visibility: 'public', pinned: true },
      { id: '20260912-001', createdAt: '2026-09-12T18:30:00+08:00', updatedAt: '2026-09-12T18:30:00+08:00', content: 'A local tweet for the admin preview.', lang: 'en', tags: ['preview'], visibility: 'private', pinned: false, translations: { 'zh-CN': { content: '用于管理面板预览的本地推文。', sourceLang: 'en', translatedAt: DEV_NOW, model: 'local-preview', promptKey: 'translate-to-zh-CN' } } },
    ],
  },
];

function tweetMonth(value: string) {
  return value.slice(0, 7);
}

function ensureTweetMonth(month: string) {
  const existing = developmentTweets.find((record) => record.month === month);
  if (existing) return existing;
  const created: TweetMonthRecord = { month, path: `tweets/${month}.json`, count: 0, updatedAt: DEV_NOW, tweets: [] };
  developmentTweets = [created, ...developmentTweets];
  return created;
}

export function getDevelopmentTweetsData(): TweetsDashboardData {
  return { repo: clone(developmentRepo), tweetsDirPath: 'local://arsvine-content-preview/tweets', months: clone(developmentTweets) };
}

function localTranslations(content: string, sourceLang: CreateTweetInput['lang']): Partial<Record<'zh-CN' | 'zh-TW' | 'en', TweetTranslation>> {
  return Object.fromEntries((sourceLang === 'en' ? ['zh-CN', 'zh-TW'] : ['en']).map((locale) => [locale, { content: `[${locale} preview] ${content}`, sourceLang: sourceLang ?? 'other', translatedAt: DEV_NOW, model: 'local-preview', promptKey: `translate-to-${locale}` as TweetTranslation['promptKey'] }])) as Partial<Record<'zh-CN' | 'zh-TW' | 'en', TweetTranslation>>;
}

export function createDevelopmentTweet(input: CreateTweetInput) {
  const createdAt = input.createdAt ?? '2026-09-13T12:00';
  const month = tweetMonth(createdAt);
  const record = ensureTweetMonth(month);
  const day = createdAt.slice(0, 10).replaceAll('-', '');
  const sequence = record.tweets.filter((tweet) => tweet.id.startsWith(`${day}-`)).length + 1;
  const tweet: TweetItem = { id: `${day}-${String(sequence).padStart(3, '0')}`, createdAt, updatedAt: DEV_NOW, content: input.content.trim(), lang: input.lang, tags: input.tags ?? [], visibility: input.visibility ?? 'public', pinned: Boolean(input.pinned), ...(input.autoTranslate ? { translations: localTranslations(input.content, input.lang) } : {}) };
  record.tweets.push(tweet);
  record.count = record.tweets.length;
  record.updatedAt = DEV_NOW;
  return { tweet, month };
}

function findDevelopmentTweet(id: string) {
  for (const record of developmentTweets) {
    const index = record.tweets.findIndex((tweet) => tweet.id === id);
    if (index >= 0) return { record, index, tweet: record.tweets[index] };
  }
  return null;
}

export function updateDevelopmentTweet(id: string, input: UpdateTweetInput) {
  const found = findDevelopmentTweet(id);
  if (!found) return null;
  const next = { ...found.tweet, ...input, tags: input.tags ?? found.tweet.tags, updatedAt: DEV_NOW };
  found.record.tweets[found.index] = next;
  found.record.updatedAt = DEV_NOW;
  return { tweet: next, month: found.record.month };
}

export function deleteDevelopmentTweet(id: string) {
  const found = findDevelopmentTweet(id);
  if (!found) return null;
  found.record.tweets.splice(found.index, 1);
  found.record.count = found.record.tweets.length;
  found.record.updatedAt = DEV_NOW;
  developmentTweets = developmentTweets.filter((record) => record.tweets.length > 0);
  return { deletedId: id, month: found.record.month };
}

export function retranslateDevelopmentTweet(id: string) {
  const found = findDevelopmentTweet(id);
  if (!found) return null;
  const next = { ...found.tweet, translations: localTranslations(found.tweet.content, found.tweet.lang), updatedAt: DEV_NOW };
  found.record.tweets[found.index] = next;
  found.record.updatedAt = DEV_NOW;
  return { tweet: next, month: found.record.month };
}

export function syncDevelopmentTweets(mode: 'recent' | 'backfill'): XSyncData {
  return { configured: true, mode, fetched: 0, created: 0, updated: 0, removed: 0, changed: false, months: [], hasMore: false, syncedAt: DEV_NOW };
}

const developmentMembers: Member[] = [
  { id: DEVELOPMENT_USER_ID, email: DEVELOPMENT_EMAIL, role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: DEV_NOW },
  { id: '00000000-0000-4000-8000-000000000098', email: 'editor@localhost', role: 'editor', status: 'active', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: DEV_NOW },
];
const developmentInvitations: Invitation[] = [];

export function getDevelopmentMembers(): MembersData {
  return { members: clone(developmentMembers), invitations: clone(developmentInvitations) };
}

export function createDevelopmentInvitation(email: string): InviteData {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
  const id = randomUUID();
  developmentInvitations.push({ id, email: email.trim().toLowerCase(), status: 'pending', expiresAt, createdAt: now.toISOString() });
  return { invitationUrl: `http://localhost:3000/activate?token=development-${id}`, expiresAt };
}

export function revokeDevelopmentInvitation(id: string) {
  const index = developmentInvitations.findIndex((invitation) => invitation.id === id);
  if (index < 0) return false;
  developmentInvitations.splice(index, 1);
  return true;
}

export function setDevelopmentMemberStatus(id: string, status: 'active' | 'disabled') {
  const member = developmentMembers.find((candidate) => candidate.id === id);
  if (!member || member.role === 'owner') return false;
  member.status = status;
  member.updatedAt = DEV_NOW;
  return true;
}

const developmentCredentials: SecurityCredential[] = [{ id: 'development-credential', label: 'Local preview key', aaguid: 'development', attestationFormat: 'none', transports: ['internal'], deviceType: 'singleDevice', backedUp: false, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: DEV_NOW }];

export function getDevelopmentSecurity(): SecurityData {
  return { authMethod: 'webauthn', credentials: clone(developmentCredentials) };
}

export function registerDevelopmentCredential(label: string) {
  const credential: SecurityCredential = { id: `development-${randomUUID()}`, label: label.trim() || 'Local preview key', aaguid: 'development', attestationFormat: 'none', transports: ['internal'], deviceType: 'singleDevice', backedUp: false, createdAt: DEV_NOW, lastUsedAt: DEV_NOW };
  developmentCredentials.push(credential);
  return { credentialId: credential.id, authMethod: 'webauthn' as const };
}

export function revokeDevelopmentCredential(id: string) {
  if (developmentCredentials.length <= 1) return false;
  const index = developmentCredentials.findIndex((credential) => credential.id === id);
  if (index < 0) return false;
  developmentCredentials.splice(index, 1);
  return true;
}
