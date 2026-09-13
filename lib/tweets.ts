import {
  TWEET_LANGS,
  TWEET_VISIBILITIES,
  type CreateTweetInput,
  type ImportedTweet,
  type RepoSummary,
  type TweetIndexItem,
  type TweetItem,
  type TweetLang,
  type TweetMonthRecord,
  type TweetTranslation,
  type TweetOrigin,
  type TweetVisibility,
  type TweetsDashboardData,
  type UpdateTweetInput,
} from './tweets-types';
import { buildTweetTranslations, markTweetTranslationsStale } from './tweet-translation';
import {
  deleteFile,
  getContentRepoInfo,
  getFile,
  GitHubError,
  listTweetMonthPaths,
  putFile,
} from './github';
import { InputValidationError, sanitizeCommitMessage, validateTweetId } from './input-validation';

const SHANGHAI_TIMEZONE = 'Asia/Shanghai';
const INDEX_PATH = 'tweets/index.json';
const MONTH_FILE_PATTERN = /^tweets\/\d{4}-\d{2}\.json$/;

class StoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
  }
}

function toStoreError(error: unknown) {
  if (error instanceof StoreError) return error;
  if (error instanceof GitHubError) {
    if (error.status === 409 || error.status === 422) {
      return new StoreError(
        409,
        'Content repository changed while saving. Please reload and retry.',
      );
    }
    if (error.status === 404) {
      return new StoreError(404, 'Content repository file not found.');
    }
    return new StoreError(502, 'GitHub content repository request failed.');
  }
  return error;
}

function getDateParts(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new StoreError(400, 'Invalid date value.');
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function toShanghaiIso(value: Date | string) {
  const { year, month, day, hour, minute, second } = getDateParts(value);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

function normalizeCreatedAtInput(rawValue?: string) {
  if (!rawValue) {
    return toShanghaiIso(new Date());
  }

  const trimmed = rawValue.trim();
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (localMatch) {
    const [, year, month, day, hour, minute, second = '00'] = localMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
  }

  return toShanghaiIso(trimmed);
}

function sortTweets(tweets: TweetItem[]) {
  return [...tweets].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function uniqueTags(tags?: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags ?? []) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function assertLang(value?: string): TweetLang | undefined {
  if (!value) return undefined;
  if (!TWEET_LANGS.includes(value as TweetLang)) {
    throw new StoreError(400, `Unsupported lang: ${value}`);
  }
  return value as TweetLang;
}

function assertVisibility(value?: string): TweetVisibility {
  const visibility = value ?? 'public';
  if (!TWEET_VISIBILITIES.includes(visibility as TweetVisibility)) {
    throw new StoreError(400, `Unsupported visibility: ${visibility}`);
  }
  return visibility as TweetVisibility;
}

function assertContent(value?: string) {
  const content = value?.trim() ?? '';
  if (!content) {
    throw new StoreError(400, 'Tweet content cannot be empty.');
  }
  return content;
}

function monthFromDate(value: string) {
  const { year, month } = getDateParts(value);
  return `${year}-${month}`;
}

function dayFromDate(value: string) {
  const { year, month, day } = getDateParts(value);
  return `${year}${month}${day}`;
}

function buildMonthPath(month: string) {
  return `tweets/${month}.json`;
}

function parseJson<T>(path: string, content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new StoreError(500, `Invalid JSON in ${path}`);
  }
}

function serializeJson(data: unknown) {
  return `${JSON.stringify(data, null, 4)}\n`;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  const file = await getFile(filePath);
  if (!file) return fallback;
  return parseJson<T>(filePath, file.content);
}

async function writeJsonFile(filePath: string, data: unknown, message: string) {
  const file = await getFile(filePath);
  await putFile({
    path: filePath,
    content: serializeJson(data),
    message,
    sha: file?.sha,
  });
}

async function deleteJsonFile(filePath: string, message: string) {
  const file = await getFile(filePath);
  if (!file) return;
  await deleteFile({
    path: filePath,
    message,
    sha: file.sha,
  });
}

async function loadIndexMetaMap() {
  const items = await readJsonFile<TweetIndexItem[]>(INDEX_PATH, []);
  return new Map(items.map((item) => [item.month, item]));
}

async function loadMonthRecords(): Promise<TweetMonthRecord[]> {
  try {
    const indexMetaMap = await loadIndexMetaMap();
    const monthPathsFromTree = await listTweetMonthPaths();
    const monthPathsFromIndex = [...indexMetaMap.values()]
      .map((item) => item.path)
      .filter((path) => MONTH_FILE_PATTERN.test(path));
    const monthPaths = [...new Set([...monthPathsFromTree, ...monthPathsFromIndex])].sort((a, b) =>
      b.localeCompare(a),
    );

    const months = await Promise.all(
      monthPaths.map(async (filePath) => {
        const month = filePath.replace(/^tweets\//, '').replace(/\.json$/, '');
        const tweets = await readJsonFile<TweetItem[]>(filePath, []);
        const meta = indexMetaMap.get(month);

        return {
          month,
          path: filePath,
          count: tweets.length,
          updatedAt:
            meta?.updatedAt ??
            sortTweets(tweets)
              .map((tweet) => tweet.updatedAt ?? tweet.createdAt)
              .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0],
          tweets,
        } satisfies TweetMonthRecord;
      }),
    );

    return months;
  } catch (error) {
    throw toStoreError(error);
  }
}

async function saveMonthRecords(records: TweetMonthRecord[], message = 'chore: update tweets') {
  const safeMessage = sanitizeCommitMessage(message);
  try {
    const sortedRecords = [...records].sort((a, b) => b.month.localeCompare(a.month));
    const existingMonthPaths = await listTweetMonthPaths();
    const nextMonthPaths = new Set(sortedRecords.map((record) => buildMonthPath(record.month)));

    for (const filePath of existingMonthPaths) {
      if (!nextMonthPaths.has(filePath)) {
        await deleteJsonFile(filePath, safeMessage);
      }
    }

    for (const record of sortedRecords) {
      await writeJsonFile(buildMonthPath(record.month), record.tweets, safeMessage);
    }

    const index: TweetIndexItem[] = sortedRecords.map((record) => ({
      month: record.month,
      path: record.path,
      count: record.tweets.length,
      updatedAt: record.updatedAt,
    }));

    await writeJsonFile(INDEX_PATH, index, safeMessage);
  } catch (error) {
    throw toStoreError(error);
  }
}

function findTweet(records: TweetMonthRecord[], tweetId: string) {
  // Tweet ids are server-generated as `YYYYMMDD-NNN`. Validate the URL
  // segment before letting it touch comparison loops or commit messages —
  // a stray `/` or control char would otherwise propagate into GitHub.
  let validatedId: string;
  try {
    validatedId = validateTweetId(tweetId);
  } catch (error) {
    if (error instanceof InputValidationError) {
      throw new StoreError(error.status, 'Invalid tweet id.');
    }
    throw error;
  }

  for (const record of records) {
    const tweetIndex = record.tweets.findIndex((tweet) => tweet.id === validatedId);
    if (tweetIndex !== -1) {
      return { record, tweetIndex };
    }
  }

  throw new StoreError(404, 'Tweet not found.');
}

function buildTweet(
  input: CreateTweetInput,
  siblingTweets: TweetItem[],
  translations?: Partial<Record<string, TweetTranslation>>,
) {
  const createdAt = normalizeCreatedAtInput(input.createdAt);
  const dayKey = dayFromDate(createdAt);
  const sequence =
    siblingTweets
      .map((tweet) => {
        const match = new RegExp(`^${dayKey}-(\\d{3})$`).exec(tweet.id);
        return match ? Number(match[1]) : 0;
      })
      .reduce((maxValue, currentValue) => Math.max(maxValue, currentValue), 0) + 1;

  const id = `${dayKey}-${String(sequence).padStart(3, '0')}`;

  return {
    id,
    createdAt,
    updatedAt: createdAt,
    content: assertContent(input.content),
    lang: assertLang(input.lang),
    tags: uniqueTags(input.tags),
    visibility: assertVisibility(input.visibility),
    pinned: Boolean(input.pinned),
    translations,
  } satisfies TweetItem;
}

function getRepoSummary(): RepoSummary {
  const repo = getContentRepoInfo();
  return {
    name: `${repo.owner}/${repo.repo}`,
    branch: repo.branch,
    originUrl: repo.url,
    upstreamBranch: undefined,
    hasChanges: false,
    changedFilesCount: 0,
    hasRemote: true,
    aheadCount: 0,
    behindCount: 0,
  };
}

function getRepoPaths() {
  const repo = getContentRepoInfo();
  return {
    tweetsDirPath: `github://${repo.owner}/${repo.repo}@${repo.branch}/tweets`,
  };
}

export async function getDashboardData(): Promise<TweetsDashboardData> {
  const records = await loadMonthRecords();
  return {
    repo: getRepoSummary(),
    ...getRepoPaths(),
    months: records.map((record) => ({
      ...record,
      tweets: sortTweets(record.tweets),
    })),
  };
}

function sourceKey(origin?: TweetOrigin) {
  return origin?.provider === 'x' ? origin.externalId : undefined;
}

function sameOrigin(left: TweetOrigin | undefined, right: TweetOrigin) {
  return Boolean(
    left &&
    left.provider === right.provider &&
    left.externalId === right.externalId &&
    left.canonicalUrl === right.canonicalUrl &&
    left.authorId === right.authorId &&
    left.authorUsername === right.authorUsername,
  );
}

export async function mergeImportedTweets(
  posts: ImportedTweet[],
  syncAt = toShanghaiIso(new Date()),
) {
  if (posts.length === 0) return { created: 0, updated: 0, changed: false, months: [] as string[] };

  const records = await loadMonthRecords();
  const existingByExternalId = new Map<string, { record: TweetMonthRecord; index: number }>();
  for (const record of records) {
    record.tweets.forEach((tweet, index) => {
      const key = sourceKey(tweet.origin);
      if (key) existingByExternalId.set(key, { record, index });
    });
  }

  let created = 0;
  let updated = 0;
  const changedMonths = new Set<string>();

  for (const post of posts) {
    const createdAt = normalizeCreatedAtInput(post.createdAt);
    const targetMonth = monthFromDate(createdAt);
    const existingLocation = existingByExternalId.get(post.externalId);
    const existingTweet = existingLocation?.record.tweets[existingLocation.index];
    const origin: TweetOrigin = {
      provider: 'x',
      externalId: post.externalId,
      canonicalUrl: post.canonicalUrl,
      authorId: post.authorId,
      authorUsername: post.authorUsername,
      importedAt: existingTweet?.origin?.importedAt ?? syncAt,
      syncedAt: syncAt,
    };

    if (existingLocation) {
      const existing = existingTweet;
      if (!existing) continue;
      const contentChanged = existing.content !== post.content;
      const sourceChanged =
        contentChanged ||
        existing.createdAt !== createdAt ||
        existing.lang !== post.lang ||
        !sameOrigin(existing.origin, origin);
      if (!sourceChanged) continue;

      const nextTweet: TweetItem = {
        ...existing,
        content: post.content,
        createdAt,
        lang: post.lang,
        updatedAt: syncAt,
        origin,
        translations:
          contentChanged || existing.lang !== post.lang
            ? markTweetTranslationsStale(existing.translations)
            : existing.translations,
      };

      if (existingLocation.record.month === targetMonth) {
        existingLocation.record.tweets[existingLocation.index] = nextTweet;
        existingLocation.record.updatedAt = syncAt;
        existingLocation.record.count = existingLocation.record.tweets.length;
        changedMonths.add(existingLocation.record.month);
      } else {
        existingLocation.record.tweets = existingLocation.record.tweets.filter(
          (_, index) => index !== existingLocation.index,
        );
        existingLocation.record.count = existingLocation.record.tweets.length;
        existingLocation.record.updatedAt = syncAt;
        changedMonths.add(existingLocation.record.month);

        let targetRecord = records.find((record) => record.month === targetMonth);
        if (!targetRecord) {
          targetRecord = {
            month: targetMonth,
            path: buildMonthPath(targetMonth),
            count: 0,
            updatedAt: syncAt,
            tweets: [],
          };
          records.push(targetRecord);
        }
        targetRecord.tweets.push(nextTweet);
        targetRecord.count = targetRecord.tweets.length;
        targetRecord.updatedAt = syncAt;
        changedMonths.add(targetRecord.month);
        existingByExternalId.set(post.externalId, {
          record: targetRecord,
          index: targetRecord.tweets.length - 1,
        });
      }
      updated += 1;
      continue;
    }

    let targetRecord = records.find((record) => record.month === targetMonth);
    if (!targetRecord) {
      targetRecord = {
        month: targetMonth,
        path: buildMonthPath(targetMonth),
        count: 0,
        updatedAt: syncAt,
        tweets: [],
      };
      records.push(targetRecord);
    }

    const tweet = {
      ...buildTweet(
        {
          content: post.content,
          lang: post.lang,
          tags: [],
          visibility: 'public',
          pinned: false,
          createdAt,
        },
        targetRecord.tweets,
      ),
      origin,
    } satisfies TweetItem;
    targetRecord.tweets.push(tweet);
    targetRecord.count = targetRecord.tweets.length;
    targetRecord.updatedAt = syncAt;
    existingByExternalId.set(post.externalId, {
      record: targetRecord,
      index: targetRecord.tweets.length - 1,
    });
    changedMonths.add(targetRecord.month);
    created += 1;
  }

  if (created > 0 || updated > 0) {
    await saveMonthRecords(
      records.filter((record) => record.tweets.length > 0),
      'chore: sync X timeline',
    );
  }

  return {
    created,
    updated,
    changed: created > 0 || updated > 0,
    months: [...changedMonths].sort(),
  };
}

export async function getRecentImportedXExternalIds(cutoff: string, limit = 100) {
  const records = await loadMonthRecords();
  return records
    .flatMap((record) => record.tweets)
    .filter(
      (tweet) =>
        tweet.origin?.provider === 'x' &&
        new Date(tweet.createdAt).getTime() >= new Date(cutoff).getTime(),
    )
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((tweet) => tweet.origin!.externalId)
    .slice(0, limit);
}

export async function removeImportedTweetsByExternalIds(
  externalIds: string[],
  syncAt = toShanghaiIso(new Date()),
) {
  const ids = new Set(externalIds);
  if (ids.size === 0) return { removed: 0, changed: false };
  const records = await loadMonthRecords();
  let removed = 0;
  const nextRecords = records
    .map((record) => {
      const tweets = record.tweets.filter((tweet) => {
        const shouldRemove = tweet.origin?.provider === 'x' && ids.has(tweet.origin.externalId);
        if (shouldRemove) removed += 1;
        return !shouldRemove;
      });
      return tweets.length === record.tweets.length
        ? record
        : { ...record, tweets, count: tweets.length, updatedAt: syncAt };
    })
    .filter((record) => record.tweets.length > 0);

  if (removed > 0) await saveMonthRecords(nextRecords, 'chore: remove unavailable X posts');
  return { removed, changed: removed > 0 };
}

export async function createTweet(input: CreateTweetInput) {
  const records = await loadMonthRecords();
  const sourceLang = assertLang(input.lang) ?? 'other';
  const draft = {
    content: assertContent(input.content),
    lang: sourceLang,
    tags: uniqueTags(input.tags),
    visibility: assertVisibility(input.visibility),
    pinned: Boolean(input.pinned),
    createdAt: normalizeCreatedAtInput(input.createdAt),
  };
  const targetMonth = monthFromDate(draft.createdAt);
  const targetRecord = records.find((record) => record.month === targetMonth) ?? {
    month: targetMonth,
    path: `tweets/${targetMonth}.json`,
    count: 0,
    updatedAt: draft.createdAt,
    tweets: [],
  };

  const translations = input.autoTranslate
    ? await buildTweetTranslations({
        content: draft.content,
        sourceLang,
      })
    : undefined;
  const tweet = buildTweet(draft, targetRecord.tweets, translations);
  const writeAt = toShanghaiIso(new Date());
  targetRecord.tweets = [...targetRecord.tweets, tweet];
  targetRecord.count = targetRecord.tweets.length;
  targetRecord.updatedAt = writeAt;

  const nextRecords = records.some((record) => record.month === targetMonth)
    ? records.map((record) => (record.month === targetMonth ? targetRecord : record))
    : [...records, targetRecord];

  await saveMonthRecords(nextRecords, `chore: create tweet ${tweet.id}`);

  return { tweet, month: targetMonth };
}

export async function updateTweet(tweetId: string, input: UpdateTweetInput) {
  const records = await loadMonthRecords();
  const { record, tweetIndex } = findTweet(records, tweetId);
  const existingTweet = record.tweets[tweetIndex];
  const nextContent =
    input.content === undefined ? existingTweet.content : assertContent(input.content);
  const nextLang = input.lang === undefined ? existingTweet.lang : assertLang(input.lang);
  const contentChanged = nextContent !== existingTweet.content;
  const langChanged = nextLang !== existingTweet.lang;
  if (existingTweet.origin?.provider === 'x' && (contentChanged || langChanged)) {
    throw new StoreError(409, 'X 来源内容只能通过同步更新；如需改写请新建一条本地推文。');
  }
  const nextTweet: TweetItem = {
    ...existingTweet,
    content: nextContent,
    lang: nextLang,
    tags: input.tags === undefined ? existingTweet.tags : uniqueTags(input.tags),
    visibility:
      input.visibility === undefined
        ? existingTweet.visibility
        : assertVisibility(input.visibility),
    pinned: input.pinned === undefined ? existingTweet.pinned : Boolean(input.pinned),
    translations:
      contentChanged || langChanged
        ? markTweetTranslationsStale(existingTweet.translations)
        : existingTweet.translations,
    updatedAt: toShanghaiIso(new Date()),
  };

  record.tweets = record.tweets.map((tweet, index) => (index === tweetIndex ? nextTweet : tweet));
  record.count = record.tweets.length;
  record.updatedAt = nextTweet.updatedAt;

  await saveMonthRecords(records, `chore: update tweet ${tweetId}`);

  return { tweet: nextTweet, month: record.month };
}

export async function retranslateTweet(tweetId: string) {
  const records = await loadMonthRecords();
  const { record, tweetIndex } = findTweet(records, tweetId);
  const existingTweet = record.tweets[tweetIndex];
  const sourceLang = existingTweet.lang ?? 'other';
  const translations = await buildTweetTranslations({
    content: existingTweet.content,
    sourceLang,
  });
  const updatedAt = toShanghaiIso(new Date());
  const nextTweet: TweetItem = {
    ...existingTweet,
    lang: sourceLang,
    translations,
    updatedAt,
  };

  record.tweets = record.tweets.map((tweet, index) => (index === tweetIndex ? nextTweet : tweet));
  record.count = record.tweets.length;
  record.updatedAt = updatedAt;

  await saveMonthRecords(records, `chore: retranslate tweet ${tweetId}`);

  return { tweet: nextTweet, month: record.month };
}

export async function deleteTweet(tweetId: string) {
  const records = await loadMonthRecords();
  const { record, tweetIndex } = findTweet(records, tweetId);
  const writeAt = toShanghaiIso(new Date());

  record.tweets = record.tweets.filter((_, index) => index !== tweetIndex);
  record.count = record.tweets.length;
  record.updatedAt = writeAt;

  const nextRecords = records.filter((monthRecord) => {
    if (monthRecord.month !== record.month) return true;
    return monthRecord.tweets.length > 0;
  });

  await saveMonthRecords(nextRecords, `chore: delete tweet ${tweetId}`);

  return { deletedId: tweetId, month: record.month };
}

export { StoreError };
