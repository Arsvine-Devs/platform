import type { ImportedTweet } from './tweets-types';
import type { XTimelineConfig } from './workspace-context';

const X_API_BASE_URL = 'https://api.x.com/2';
const X_ID_RE = /^\d{1,19}$/;

type XPost = {
  id?: unknown;
  text?: unknown;
  author_id?: unknown;
  created_at?: unknown;
  lang?: unknown;
};

type XResponse = {
  data?: unknown;
  includes?: { users?: unknown };
  meta?: { next_token?: unknown; newest_id?: unknown; oldest_id?: unknown };
  errors?: unknown;
};

export class XApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'XApiError';
  }
}

export type XTimelinePage = {
  posts: ImportedTweet[];
  nextCursor?: string;
  newestId?: string;
  oldestId?: string;
};

type XTimelinePageOptions = {
  sinceId?: string;
  paginationToken?: string;
  paginationSinceId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function validateId(value: string, label: string) {
  if (!X_ID_RE.test(value))
    throw new XApiError(502, 'invalid_response', `X returned an invalid ${label}.`);
  return value;
}

function normalizeLanguage(value: unknown): ImportedTweet['lang'] {
  const language = asString(value).toLowerCase();
  if (language === 'en') return 'en';
  if (language === 'ja') return 'ja';
  if (language === 'zh' || language === 'zh-cn' || language === 'zh-hans') return 'zh-CN';
  if (language === 'zh-tw' || language === 'zh-hant') return 'zh-TW';
  return 'other';
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors.find(isRecord);
  if (first) {
    const detail = asString(first.detail) || asString(first.title);
    if (detail) return detail;
  }
  const detail = asString(payload.detail) || asString(payload.title);
  return detail || fallback;
}

function getApiErrorCode(payload: unknown) {
  if (!isRecord(payload)) return 'request_failed';
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors.find(isRecord);
  return first
    ? asString(first.type) || asString(first.title) || 'request_failed'
    : 'request_failed';
}

async function xFetch(path: string, params: URLSearchParams, token: string): Promise<XResponse> {
  let response: Response;
  try {
    response = await fetch(`${X_API_BASE_URL}${path}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new XApiError(
      502,
      'network_error',
      error instanceof Error ? error.message : 'X request failed.',
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new XApiError(
      response.status,
      getApiErrorCode(payload),
      getApiErrorMessage(payload, `X API request failed with status ${response.status}.`),
    );
  }

  if (!isRecord(payload))
    throw new XApiError(502, 'invalid_response', 'X returned an invalid response.');
  return payload as XResponse;
}

function buildParams(config: XTimelineConfig, options: XTimelinePageOptions = {}) {
  const params = new URLSearchParams({
    max_results: '100',
    'tweet.fields': 'author_id,created_at,lang,text',
    expansions: 'author_id',
    'user.fields': 'username',
  });
  const excluded: string[] = [];
  if (!config.includeReplies) excluded.push('replies');
  if (!config.includeRetweets) excluded.push('retweets');
  if (excluded.length > 0) params.set('exclude', excluded.join(','));
  if (options.paginationToken) params.set('pagination_token', options.paginationToken);
  const sinceId = options.paginationToken ? options.paginationSinceId : options.sinceId;
  if (sinceId) params.set('since_id', validateId(sinceId, 'since_id'));
  return params;
}

function normalizeUsers(value: unknown) {
  const users = Array.isArray(value) ? value : [];
  return new Map(
    users
      .filter(isRecord)
      .map((user) => [asString(user.id), asString(user.username)] as const)
      .filter(([id, username]) => Boolean(id && username)),
  );
}

function normalizePosts(payload: XResponse, config: XTimelineConfig): ImportedTweet[] {
  const posts = Array.isArray(payload.data) ? payload.data : [];
  const usernames = normalizeUsers(payload.includes?.users);
  return posts.filter(isRecord).map((raw) => {
    const post = raw as XPost;
    const externalId = validateId(asString(post.id), 'post id');
    const authorId = validateId(asString(post.author_id), 'author id');
    const content = asString(post.text).trim();
    const createdAt = asString(post.created_at);
    if (!content || !createdAt)
      throw new XApiError(502, 'invalid_response', 'X returned a Post without text or created_at.');
    if (authorId !== config.targetUserId) {
      throw new XApiError(502, 'unexpected_author', 'X returned a Post from an unexpected author.');
    }
    const authorUsername = usernames.get(authorId) || config.targetUsername;
    return {
      externalId,
      createdAt,
      content,
      lang: normalizeLanguage(post.lang),
      authorId,
      authorUsername,
      canonicalUrl: `https://x.com/${encodeURIComponent(authorUsername)}/status/${externalId}`,
    } satisfies ImportedTweet;
  });
}

function readMetaString(meta: XResponse['meta'], key: 'next_token' | 'newest_id' | 'oldest_id') {
  const value = meta && isRecord(meta) ? meta[key] : undefined;
  return typeof value === 'string' && value ? value : undefined;
}

export async function fetchXTimelinePage(
  config: XTimelineConfig,
  options: XTimelinePageOptions = {},
): Promise<XTimelinePage> {
  if (!config.bearerToken)
    throw new XApiError(422, 'missing_token', 'X bearer token is not configured.');
  validateId(config.targetUserId, 'target user id');
  const payload = await xFetch(
    `/users/${encodeURIComponent(config.targetUserId)}/tweets`,
    buildParams(config, options),
    config.bearerToken,
  );
  return {
    posts: normalizePosts(payload, config),
    nextCursor: readMetaString(payload.meta, 'next_token'),
    newestId: readMetaString(payload.meta, 'newest_id'),
    oldestId: readMetaString(payload.meta, 'oldest_id'),
  };
}

export async function fetchXPostsByIds(config: XTimelineConfig, ids: string[]) {
  const validIds = [...new Set(ids)].map((id) => validateId(id, 'post id'));
  if (validIds.length === 0) return { posts: [], missingIds: [] as string[] };
  if (validIds.length > 100)
    throw new XApiError(422, 'too_many_ids', 'X lookup supports at most 100 post ids per request.');
  const params = new URLSearchParams({
    ids: validIds.join(','),
    'tweet.fields': 'author_id,created_at,lang,text',
    expansions: 'author_id',
    'user.fields': 'username',
  });
  const payload = await xFetch('/tweets', params, config.bearerToken);
  const posts = normalizePosts(payload, config);
  const returnedIds = new Set(posts.map((post) => post.externalId));
  return { posts, missingIds: validIds.filter((id) => !returnedIds.has(id)) };
}
