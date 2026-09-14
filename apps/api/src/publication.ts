import { randomUUID } from "node:crypto";
import { listPosts, listTweets } from "@arsvine/core-db";

type PublishResult = {
  releaseId: string;
  pointerKey: string;
  manifestKey: string;
  postCount: number;
  tweetCount: number;
  publishedAt: string;
};

function requiredPublisher() {
  const url = process.env.CONTENT_PUBLISH_URL?.trim();
  const token = process.env.CONTENT_PUBLISH_TOKEN?.trim();
  if (!url || !token) throw new Error("Content publisher is not configured.");
  return { url, token };
}

function requireKey(value: string) {
  if (!value || value.startsWith("/") || value.includes("..")) {
    throw new Error("Invalid object key.");
  }
  return value;
}

function monthFor(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(value));
}

export async function publishCoreRelease(): Promise<PublishResult> {
  const publisher = requiredPublisher();
  const publishedAt = new Date().toISOString();
  const releaseId = `${Date.now().toString(36).toUpperCase()}-${randomUUID()}`;
  const prefix = `realm-content/releases/${releaseId}`;
  const pointerKey = process.env.CONTENT_CURRENT_POINTER?.trim() || "realm-content/current.json";
  const posts = await listPosts({ includeBody: true });
  const tweets = await listTweets();
  const objects: Array<{ key: string; body: string }> = [];
  const postIndex = posts.map((post) => {
    const variants: Record<string, { key: string; title: string; excerpt: string; originLocale?: string }> = {};
    for (const variant of post.variants) {
      const key = `${prefix}/posts/${post.slug}/${variant.locale}.json`;
      variants[variant.locale] = {
        key,
        title: variant.title,
        excerpt: variant.excerpt,
        ...(variant.originLocale ? { originLocale: variant.originLocale } : {}),
      };
      objects.push({
        key,
        body: JSON.stringify({
          slug: post.slug,
          locale: variant.locale,
          title: variant.title,
          excerpt: variant.excerpt,
          tags: post.tags,
          date: (post.publishedAt ?? post.updatedAt).slice(0, 10),
          updatedAt: post.updatedAt,
          access: { mode: post.accessMode, ...(post.accessGroup ? { group: post.accessGroup } : {}) },
          ...(variant.originLocale ? { originLocale: variant.originLocale } : {}),
          bodyMdx: variant.bodyMdx ?? "",
        }),
      });
    }
    return {
      slug: post.slug,
      date: (post.publishedAt ?? post.updatedAt).slice(0, 10),
      updatedAt: post.updatedAt,
      tags: post.tags,
      pinned: post.pinned,
      access: { mode: post.accessMode, ...(post.accessGroup ? { group: post.accessGroup } : {}) },
      availableLocales: post.variants.map((variant) => variant.locale),
      variants,
    };
  });
  const postIndexKey = `${prefix}/posts/index.json`;
  objects.push({ key: postIndexKey, body: JSON.stringify({ posts: postIndex }) });

  const tweetsByMonth = new Map<string, typeof tweets>();
  for (const tweet of tweets) {
    const month = monthFor(tweet.createdAt);
    const current = tweetsByMonth.get(month) ?? [];
    current.push(tweet);
    tweetsByMonth.set(month, current);
  }
  const tweetIndex = [...tweetsByMonth.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, entries]) => {
      const path = `${prefix}/tweets/${month}.json`;
      objects.push({
        key: path,
        body: JSON.stringify(entries.map((tweet) => ({
          id: tweet.id,
          createdAt: tweet.createdAt,
          updatedAt: tweet.updatedAt,
          content: tweet.content,
          lang: tweet.lang,
          tags: tweet.tags,
          visibility: tweet.visibility,
          pinned: tweet.pinned,
          translations: tweet.translations,
          ...(tweet.origin ? { origin: tweet.origin } : {}),
        }))),
      });
      return { month, path, count: entries.length, updatedAt: entries[0]?.updatedAt };
    });
  const tweetIndexKey = `${prefix}/tweets/index.json`;
  objects.push({ key: tweetIndexKey, body: JSON.stringify(tweetIndex) });

  const manifestKey = `${prefix}/manifest.json`;
  objects.push({
    key: manifestKey,
    body: JSON.stringify({
      schemaVersion: 1,
      releaseId,
      publishedAt,
      posts: { index: postIndexKey },
      tweets: { index: tweetIndexKey },
    }),
  });

  const response = await fetch(publisher.url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Publication-Token": publisher.token,
    },
    body: JSON.stringify({
      releaseId,
      publishedAt,
      pointerKey: requireKey(pointerKey),
      manifestKey: requireKey(manifestKey),
      objects: objects.map((object) => ({ key: requireKey(object.key), body: object.body })),
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { releaseId?: string; error?: { code?: string } } | null;
  if (!response.ok || result?.releaseId !== releaseId) {
    throw new Error(result?.error?.code ?? "Content publication failed.");
  }
  return { releaseId, pointerKey, manifestKey, postCount: posts.length, tweetCount: tweets.length, publishedAt };
}
