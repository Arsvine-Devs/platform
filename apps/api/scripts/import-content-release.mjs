import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.CORE_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CORE_DATABASE_URL is required");
const dryRun = process.argv.includes("--dry-run");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
let storage = null;

function deterministicUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

async function json(key) {
  if (!storage) throw new Error("Object storage reader is not configured");
  return JSON.parse(await storage.getText(key));
}

function asDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

let releaseId;
let posts;
let tweets;
const exportUrl = process.env.CONTENT_MIGRATION_URL?.trim();
const migrationToken = process.env.CONTENT_MIGRATION_TOKEN?.trim();
if (exportUrl && migrationToken) {
  const response = await fetch(exportUrl, { headers: { "X-Migration-Token": migrationToken }, signal: AbortSignal.timeout(20_000) });
  const exported = await response.json();
  if (!response.ok || !exported?.releaseId || !Array.isArray(exported.posts) || !Array.isArray(exported.tweets)) {
    throw new Error("Content migration export failed");
  }
  releaseId = exported.releaseId;
  posts = exported.posts;
  tweets = exported.tweets.flatMap((entry) => Array.isArray(entry.tweets) ? entry.tweets : []);
} else {
  const { createObjectStorage, readObjectStorageConfig } = await import("../../../packages/object-storage/dist/index.js");
  const config = readObjectStorageConfig();
  if (!config) throw new Error("S3 storage configuration is required");
  storage = createObjectStorage(config);
  const pointerKey = process.env.CONTENT_CURRENT_POINTER?.trim() || "realm-content/current.json";
  const pointer = await json(pointerKey);
  const manifest = await json(pointer.manifest);
  const postIndex = manifest.posts?.index ? await json(manifest.posts.index) : { posts: [] };
  const tweetIndex = manifest.tweets?.index ? await json(manifest.tweets.index) : [];
  posts = postIndex.posts ?? postIndex;
  tweets = [];
  for (const entry of tweetIndex) {
    const month = await json(entry.path);
    if (Array.isArray(month)) tweets.push(...month);
  }
  releaseId = pointer.releaseId;
}

let importedPosts = 0;
let importedVariants = 0;
let importedTweets = 0;
let importedTweetVariants = 0;

try {
  if (!dryRun) await pool.query("BEGIN");
  for (const post of posts) {
    const postId = deterministicUuid(`post:${post.slug}`);
    const firstLocale = post.availableLocales?.[0] ?? "zh-CN";
    const publishedAt = asDate(post.date ?? post.updatedAt);
    if (!dryRun) {
      await pool.query(
        `INSERT INTO posts (id, slug, status, source_locale, pinned, access_mode, access_group, published_at, revision, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, 'published', $3, $4, $5, $6, $7, 1, 'migration:content-release', 'migration:content-release', now(), now())
         ON CONFLICT (slug) DO UPDATE SET status = EXCLUDED.status, source_locale = EXCLUDED.source_locale, pinned = EXCLUDED.pinned, access_mode = EXCLUDED.access_mode, access_group = EXCLUDED.access_group, published_at = EXCLUDED.published_at, updated_at = now()`,
        [postId, post.slug, firstLocale, Boolean(post.pinned), post.access?.mode ?? "public", post.access?.group ?? null, publishedAt],
      );
      await pool.query("DELETE FROM post_tags WHERE post_id = $1", [postId]);
      for (const tag of post.tags ?? []) {
        await pool.query("INSERT INTO post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING", [postId, tag]);
      }
    }
    importedPosts += 1;
    for (const locale of post.availableLocales ?? []) {
      const remoteVariant = Array.isArray(post.variants)
        ? post.variants.find((candidate) => candidate?.locale === locale)?.body
        : undefined;
      const descriptor = Array.isArray(post.variants) ? undefined : post.variants?.[locale];
      const key = typeof descriptor === "string" ? descriptor : descriptor?.key;
      if (!remoteVariant && !key) continue;
      const variant = remoteVariant ?? await json(key);
      const variantId = deterministicUuid(`post-variant:${post.slug}:${locale}`);
      if (!dryRun) {
        await pool.query(
          `INSERT INTO post_variants (id, post_id, locale, title, excerpt, body_mdx, origin_locale, translation_state, checksum, revision, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'source', '', 1, now(), now())
           ON CONFLICT (post_id, locale) DO UPDATE SET title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, body_mdx = EXCLUDED.body_mdx, origin_locale = EXCLUDED.origin_locale, updated_at = now()`,
          [variantId, postId, locale, variant.title ?? descriptor?.title ?? post.slug, variant.excerpt ?? descriptor?.excerpt ?? "", variant.bodyMdx ?? "", variant.originLocale ?? descriptor?.originLocale ?? null],
        );
      }
      importedVariants += 1;
    }
    if (!dryRun) {
      await pool.query(
        `INSERT INTO post_revisions (id, post_id, revision, snapshot, created_by, created_at)
         VALUES ($1, $2, 1, $3::jsonb, 'migration:content-release', now()) ON CONFLICT DO NOTHING`,
        [randomUUID(), postId, JSON.stringify({ source: "content-release", slug: post.slug })],
      );
    }
  }

  for (const tweet of tweets) {
    const tweetId = deterministicUuid(`tweet:${tweet.id}`);
    const origin = tweet.origin ?? null;
    const source = origin?.provider === "x" ? "x" : "manual";
    const publishedAt = asDate(tweet.createdAt);
    if (!dryRun) {
      await pool.query(
        `INSERT INTO tweets (id, source, external_id, visible, visibility, pinned, published_at, revision, created_by, updated_by, origin, tags, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'migration:content-release', 'migration:content-release', $8::jsonb, $9::jsonb, now(), now())
         ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, external_id = EXCLUDED.external_id, visible = EXCLUDED.visible, visibility = EXCLUDED.visibility, pinned = EXCLUDED.pinned, published_at = EXCLUDED.published_at, origin = EXCLUDED.origin, tags = EXCLUDED.tags, updated_at = now()`,
        [tweetId, source, origin?.externalId ?? null, tweet.visibility !== "hidden", tweet.visibility ?? "public", Boolean(tweet.pinned), publishedAt, JSON.stringify(origin), JSON.stringify(tweet.tags ?? [])],
      );
      await pool.query(
        `INSERT INTO tweet_variants (tweet_id, locale, body, origin_locale, translation_state, revision, created_at, updated_at)
         VALUES ($1, 'source', $2, $3, 'source', 1, now(), now())
         ON CONFLICT (tweet_id, locale) DO UPDATE SET body = EXCLUDED.body, origin_locale = EXCLUDED.origin_locale, updated_at = now()`,
        [tweetId, tweet.content ?? "", tweet.lang ?? null],
      );
      for (const [locale, translation] of Object.entries(tweet.translations ?? {})) {
        if (!translation || typeof translation !== "object") continue;
        const value = translation;
        await pool.query(
          `INSERT INTO tweet_variants (tweet_id, locale, body, origin_locale, translation_state, revision, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 1, now(), now())
           ON CONFLICT (tweet_id, locale) DO UPDATE SET body = EXCLUDED.body, origin_locale = EXCLUDED.origin_locale, translation_state = EXCLUDED.translation_state, updated_at = now()`,
          [tweetId, locale, value.content ?? "", tweet.lang ?? null, value.stale ? "stale" : "translated"],
        );
        importedTweetVariants += 1;
      }
    }
    importedTweets += 1;
  }

  if (!dryRun) await pool.query("COMMIT");
  console.log(JSON.stringify({ dryRun, releaseId, importedPosts, importedVariants, importedTweets, importedTweetVariants }));
} catch (error) {
  if (!dryRun) await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
