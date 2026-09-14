import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createObjectStorage,
  readObjectStorageConfig,
} from "../packages/object-storage/dist/index.js";

const contentRoot = path.resolve(
  process.env.LEGACY_CONTENT_ROOT ?? "../arsvine-content",
);
const pointerKey = process.env.CONTENT_CURRENT_POINTER ?? "realm-content/current.json";
const publishedAt = new Date().toISOString();
const releaseId = `${Date.now().toString(36).toUpperCase()}-${randomUUID()}`;
const releasePrefix = `realm-content/releases/${releaseId}`;

function required(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(contentRoot, relativePath), "utf8"));
}

async function readMdxBody(relativePath) {
  const source = await readFile(path.join(contentRoot, relativePath), "utf8");
  const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return (frontmatter?.[1] ?? source).trimStart();
}

function variantKey(slug, locale) {
  return `${releasePrefix}/posts/${slug}/${locale}.json`;
}

async function buildPosts(blogIndex) {
  const posts = [];
  const objects = [];
  for (const post of blogIndex.posts ?? []) {
    const variants = {};
    for (const locale of post.availableLocales ?? []) {
      const metadata = post.variants?.[locale] ?? {};
      const key = variantKey(post.slug, locale);
      variants[locale] = {
        key,
        title: metadata.title,
        excerpt: metadata.excerpt,
        ...(metadata.originLocale ? { originLocale: metadata.originLocale } : {}),
      };
      objects.push({
        key,
        body: JSON.stringify({
          slug: post.slug,
          locale,
          title: metadata.title,
          excerpt: metadata.excerpt,
          tags: metadata.tags ?? post.tags ?? [],
          date: post.date,
          updatedAt: post.updatedAt,
          access: post.access,
          ...(metadata.originLocale ? { originLocale: metadata.originLocale } : {}),
          bodyMdx: await readMdxBody(`blog/${post.slug}/${locale}.mdx`),
        }),
      });
    }
    posts.push({
      slug: post.slug,
      date: post.date,
      updatedAt: post.updatedAt,
      tags: post.tags ?? [],
      pinned: Boolean(post.pinned),
      access: post.access ?? { mode: "public" },
      availableLocales: post.availableLocales ?? [],
      variants,
    });
  }
  return { posts, objects };
}

async function main() {
  const config = readObjectStorageConfig();
  if (!config) throw new Error("S3 storage configuration is incomplete");
  const storage = createObjectStorage(config);
  const blogIndex = await readJson("blog-index.json");
  const tweetIndex = await readJson("tweets/index.json");
  const { posts, objects } = await buildPosts(blogIndex);

  const postIndexKey = `${releasePrefix}/posts/index.json`;
  const tweetIndexKey = `${releasePrefix}/tweets/index.json`;
  const manifestKey = `${releasePrefix}/manifest.json`;
  objects.push({ key: postIndexKey, body: JSON.stringify({ posts }) });
  objects.push({ key: tweetIndexKey, body: JSON.stringify(tweetIndex) });
  for (const entry of tweetIndex) {
    const monthKey = `${releasePrefix}/tweets/${entry.path}`;
    objects.push({ key: monthKey, body: JSON.stringify(await readJson(entry.path)) });
  }

  const manifest = {
    schemaVersion: 1,
    releaseId,
    publishedAt,
    posts: { index: postIndexKey },
    tweets: { index: tweetIndexKey },
  };
  objects.push({ key: manifestKey, body: JSON.stringify(manifest) });

  for (const object of objects) {
    await storage.putText(object.key, object.body);
    const verified = await storage.getText(object.key);
    if (verified !== object.body) throw new Error(`Object verification failed: ${object.key}`);
  }

  const pointer = {
    schemaVersion: 1,
    releaseId,
    publishedAt,
    manifest: manifestKey,
  };
  await storage.putText(pointerKey, JSON.stringify(pointer));
  const pointerVerified = JSON.parse(await storage.getText(pointerKey));
  if (pointerVerified.releaseId !== releaseId || pointerVerified.manifest !== manifestKey) {
    throw new Error("Current pointer verification failed");
  }

  console.log(JSON.stringify({ releaseId, pointerKey, manifestKey, postCount: posts.length }));
}

await main();
