export type AdminApiSuccess<T> = { ok: true; data: T };
export type AdminApiVoidSuccess = { ok: true };
export type AdminApiFailure = {
  ok: false;
  error: { code?: string; message: string };
};
export type AdminApiResponse<T> = AdminApiSuccess<T> | AdminApiVoidSuccess | AdminApiFailure;

export type BlogLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ru' | 'fr';
export const BLOG_LOCALES: readonly BlogLocale[] = ['zh-CN', 'zh-TW', 'en', 'ja', 'ru', 'fr'];
export type BlogAccessMode = 'public' | 'totp';

export type BlogIndexVariant = {
  title: string;
  excerpt: string;
  tags?: string[];
  originLocale?: BlogLocale;
};

export type BlogIndexItem = {
  slug: string;
  date: string;
  updatedAt: string;
  tags: string[];
  pinned: boolean;
  access: { mode: BlogAccessMode; group?: string };
  availableLocales: BlogLocale[];
  variants: Partial<Record<BlogLocale, BlogIndexVariant>>;
};

export type BlogIndexData = {
  version: number;
  updatedAt: string;
  posts: BlogIndexItem[];
};

export type BlogVariantData = {
  slug: string;
  locale: BlogLocale;
  title: string;
  excerpt: string;
  date: string;
  tags: string[];
  pinned: boolean;
  accessMode: BlogAccessMode;
  accessGroup: string;
  originLocale: string;
  content: string;
};

export type BlogPublishInput = {
  slug: string;
  locale: BlogLocale;
  title: string;
  excerpt: string;
  date: string;
  tags: string[];
  pinned: boolean;
  accessMode: BlogAccessMode;
  accessGroup?: string;
  content: string;
  originLocale?: BlogLocale;
};

export type BlogPublishVariantInput = {
  locale: BlogLocale;
  title: string;
  excerpt: string;
  tags: string[];
  content: string;
  originLocale?: BlogLocale;
};

export type BlogPublishBatchInput = {
  slug: string;
  date: string;
  pinned: boolean;
  accessMode: BlogAccessMode;
  accessGroup?: string;
  variants: BlogPublishVariantInput[];
};

export type BlogPublishResponse = {
  path?: string;
  paths?: string[];
  commits?: unknown[];
  revalidated?: { revalidated: boolean; paths: string[]; error?: string };
};

export type BlogTranslateInput = {
  title: string;
  excerpt: string;
  tags: string[];
  content: string;
  sourceLocale: 'zh-CN';
  targetLocales?: Array<'zh-TW' | 'en'>;
};

export type BlogTranslationVariant = {
  locale: 'zh-TW' | 'en';
  title: string;
  excerpt: string;
  tags: string[];
  content: string;
  originLocale: string;
};

export type BlogTranslateResponse = {
  variants: BlogTranslationVariant[];
};

export type RevalidationResult = {
  revalidated: boolean;
  paths: string[];
  error?: string;
};

export type BlogRebuildData = {
  index: BlogIndexData;
  revalidated: RevalidationResult;
};

export type LibraryItem = {
  id: string;
  type: 'blog' | 'tweet';
  title: string;
  locale: string;
  status: 'draft' | 'published';
  updatedAt: string;
  href: string;
};

export type LibraryData = { items: LibraryItem[] };

export type WorkspaceSummary = {
  github: {
    owner: string;
    repo: string;
    branch: string;
    hasToken: boolean;
  };
  revalidate: {
    contentUrl?: string;
    tweetsUrl?: string;
    hasContentUrl: boolean;
    hasTweetsUrl: boolean;
    hasSecret: boolean;
  };
  translation: {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
  } | null;
  x: {
    syncMethod: 'none' | 'api';
    targetUserId: string;
    targetUsername: string;
    hasBearerToken: boolean;
    includeReplies: boolean;
    includeRetweets: boolean;
    lastSyncAt: string | null;
    hasPendingBackfill: boolean;
  } | null;
};

export type WorkspaceUpdateInput = {
  github?: {
    owner?: string;
    repo?: string;
    branch?: string;
    token?: string;
  };
  revalidate?: {
    contentUrl?: string;
    tweetsUrl?: string;
    secret?: string;
  };
  translation?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    thinking?: string;
    reasoningEffort?: string;
  };
  x?: {
    syncMethod?: 'none' | 'api';
    bearerToken?: string;
    targetUserId?: string;
    targetUsername?: string;
    includeReplies?: boolean;
    includeRetweets?: boolean;
  } | null;
};

export type WorkspaceVerifyData = {
  repository: { owner: string; repo: string };
};

export type Member = {
  id: string;
  email: string;
  role: 'owner' | 'editor';
  status: 'pending' | 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
};

export type Invitation = {
  id: string;
  email: string;
  status: 'pending';
  expiresAt: string;
  createdAt: string;
};

export type MembersData = {
  members: Member[];
  invitations: Invitation[];
};

export type InviteData = {
  invitationUrl: string;
  expiresAt: string;
};

export type SecurityCredential = {
  id: string;
  label: string;
  aaguid: string;
  attestationFormat: string;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type SecurityData = {
  authMethod: 'password+totp' | 'webauthn';
  credentials: SecurityCredential[];
};

export type SessionData = {
  userId: string;
  email: string;
  role: 'owner' | 'editor';
  exp: number;
  authAt: number;
  csrf: string;
  amr: 'password+totp' | 'webauthn' | 'oidc';
  developmentBypass?: boolean;
  controlPlane?: {
    id: string;
    role: 'owner' | 'editor' | null;
    scopes: string[];
  };
};

export type LoginData = {
  role: 'owner' | 'editor';
  authMethod: 'password+totp' | 'webauthn';
  needsWebAuthnSetup?: boolean;
};

export type XSyncData = {
  configured: true;
  mode: 'recent' | 'backfill';
  fetched: number;
  created: number;
  updated: number;
  removed: number;
  changed: boolean;
  months: string[];
  hasMore: boolean;
  nextCursor?: string;
  revalidated?: { revalidated: boolean; paths: string[]; error?: string };
  syncedAt: string;
};
