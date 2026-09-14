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

export type SessionData = {
  userId: string;
  email: string;
  role: 'owner' | 'editor';
  exp: number;
  authAt: number;
  csrf: string;
  amr: 'oidc';
  controlPlane?: {
    id: string;
    role: 'owner' | 'editor' | null;
    scopes: string[];
  };
};
