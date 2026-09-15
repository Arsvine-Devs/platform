export const TWEET_LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'other'] as const;
export const SITE_TWEET_LOCALES = ['zh-CN', 'zh-TW', 'en'] as const;
export const TWEET_VISIBILITIES = ['public', 'private', 'hidden'] as const;
export const TWEET_FILTERS = ['all', 'public', 'private', 'hidden', 'pinned'] as const;
export type TweetLang = (typeof TWEET_LANGS)[number];
export type SiteTweetLocale = (typeof SITE_TWEET_LOCALES)[number];
export type TweetVisibility = (typeof TWEET_VISIBILITIES)[number];
export type TweetFilter = (typeof TWEET_FILTERS)[number];
type TweetTranslationPromptKey = `translate-to-${SiteTweetLocale}`;

type TweetOrigin = {
  provider: 'x';
  externalId: string;
  canonicalUrl: string;
  authorId: string;
  authorUsername: string;
  importedAt: string;
  syncedAt?: string;
};

type TweetTranslation = {
  content: string;
  sourceLang: TweetLang;
  translatedAt: string;
  model: string;
  promptKey: TweetTranslationPromptKey;
  stale?: boolean;
};

export type TweetItem = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  content: string;
  lang?: TweetLang;
  tags?: string[];
  visibility?: TweetVisibility;
  pinned?: boolean;
  translations?: Partial<Record<SiteTweetLocale, TweetTranslation>>;
  origin?: TweetOrigin;
};

export type TweetMonthRecord = {
  month: string;
  count: number;
  updatedAt?: string;
  tweets: TweetItem[];
};

export type TweetsDashboardData = {
  months: TweetMonthRecord[];
};

export type CreateTweetInput = {
  content: string;
  lang?: TweetLang;
  tags?: string[];
  visibility?: TweetVisibility;
  pinned?: boolean;
  createdAt?: string;
};

export type UpdateTweetInput = {
  content?: string;
  lang?: TweetLang;
  tags?: string[];
  visibility?: TweetVisibility;
  pinned?: boolean;
};

export function getTranslationTargetLocales(sourceLang?: TweetLang): SiteTweetLocale[] {
  if (sourceLang === 'zh-CN') return ['zh-TW', 'en'];
  if (sourceLang === 'zh-TW') return ['zh-CN', 'en'];
  if (sourceLang === 'en') return ['zh-CN', 'zh-TW'];
  return [...SITE_TWEET_LOCALES];
}
