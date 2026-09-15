import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { readEnv } from "@arsvine/env";

export * from "./schema.js";

export type CoreDb = ReturnType<typeof createCoreDb>;

function createCoreDb() {
  const url = readEnv("CORE_DATABASE_URL");
  if (!url) throw new Error("Missing CORE_DATABASE_URL");
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzle(pool, { schema });
}

let db: CoreDb | null = null;

export function getCoreDb() {
  db ??= createCoreDb();
  return db;
}

export type PostVariantInput = {
  locale: string;
  title: string;
  excerpt?: string;
  bodyMdx?: string;
  originLocale?: string;
  translationState?: string;
};

export type PostInput = {
  slug: string;
  sourceLocale: string;
  pinned?: boolean;
  accessMode?: "public" | "totp";
  accessGroup?: string;
  status?: "draft" | "published" | "archived";
  date?: string;
  tags?: string[];
  variant?: PostVariantInput;
};

export type TweetInput = {
  content: string;
  locale?: string;
  tags?: string[];
  visibility?: "public" | "private" | "hidden";
  pinned?: boolean;
  publishedAt?: string;
  source?: "manual" | "x";
  externalId?: string;
  origin?: Record<string, unknown>;
};

function normalizeTags(tags: readonly string[] | undefined) {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function asDate(value: string | Date | undefined, fallback = new Date()) {
  const date =
    value instanceof Date ? value : value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date value.");
  return date;
}

function checksum(value: string) {
  // The checksum is an integrity hint for publication builders. The API does
  // not use it as an authorization or concurrency primitive.
  return Buffer.from(value, "utf8").toString("base64url");
}

async function tagsForPost(db: CoreDb, postId: string) {
  const rows = await db
    .select()
    .from(schema.postTags)
    .where(eq(schema.postTags.postId, postId));
  return rows.map((row) => row.tag);
}

async function variantsForPost(
  db: CoreDb,
  postId: string,
  includeBody: boolean,
) {
  const rows = await db
    .select()
    .from(schema.postVariants)
    .where(eq(schema.postVariants.postId, postId))
    .orderBy(asc(schema.postVariants.locale));
  return rows.map((row) => ({
    id: row.id,
    locale: row.locale,
    title: row.title,
    excerpt: row.excerpt,
    ...(includeBody ? { bodyMdx: row.bodyMdx } : {}),
    originLocale: row.originLocale,
    translationState: row.translationState,
    readingMinutes: row.readingMinutes,
    checksum: row.checksum,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function postView(
  db: CoreDb,
  row: typeof schema.posts.$inferSelect,
  includeBody: boolean,
) {
  const [tags, variants] = await Promise.all([
    tagsForPost(db, row.id),
    variantsForPost(db, row.id, includeBody),
  ]);
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    sourceLocale: row.sourceLocale,
    pinned: row.pinned,
    accessMode: row.accessMode,
    accessGroup: row.accessGroup,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    revision: row.revision,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tags,
    variants,
  };
}

export async function listPosts(options: { includeBody?: boolean } = {}) {
  const database = getCoreDb();
  const rows = await database
    .select()
    .from(schema.posts)
    .where(sql`${schema.posts.status} <> 'archived'`)
    .orderBy(desc(schema.posts.pinned), desc(schema.posts.updatedAt));
  return Promise.all(
    rows.map((row) => postView(database, row, options.includeBody === true)),
  );
}

export async function findPost(idOrSlug: string, includeBody = true) {
  const database = getCoreDb();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrSlug,
    );
  const [row] = await database
    .select()
    .from(schema.posts)
    .where(
      isUuid
        ? or(eq(schema.posts.id, idOrSlug), eq(schema.posts.slug, idOrSlug))
        : eq(schema.posts.slug, idOrSlug),
    )
    .limit(1);
  return row ? postView(database, row, includeBody) : null;
}

export async function findPostVariant(idOrSlug: string, locale: string) {
  const database = getCoreDb();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrSlug,
    );
  const [post] = await database
    .select()
    .from(schema.posts)
    .where(
      isUuid
        ? or(eq(schema.posts.id, idOrSlug), eq(schema.posts.slug, idOrSlug))
        : eq(schema.posts.slug, idOrSlug),
    )
    .limit(1);
  if (!post) return null;
  const [variant] = await database
    .select()
    .from(schema.postVariants)
    .where(
      and(
        eq(schema.postVariants.postId, post.id),
        eq(schema.postVariants.locale, locale),
      ),
    )
    .limit(1);
  if (!variant) return null;
  return {
    post: await postView(database, post, false),
    variant: {
      id: variant.id,
      locale: variant.locale,
      title: variant.title,
      excerpt: variant.excerpt,
      bodyMdx: variant.bodyMdx,
      originLocale: variant.originLocale,
      translationState: variant.translationState,
      revision: variant.revision,
      updatedAt: variant.updatedAt.toISOString(),
    },
  };
}

export async function createPost(input: PostInput, actorId: string) {
  const database = getCoreDb();
  const now = new Date();
  const id = randomUUID();
  const tags = normalizeTags(input.tags);
  const variant = input.variant;
  await database.transaction(async (tx) => {
    await tx.insert(schema.posts).values({
      id,
      slug: input.slug,
      status: input.status ?? "draft",
      sourceLocale: input.sourceLocale,
      pinned: input.pinned ?? false,
      accessMode: input.accessMode ?? "public",
      accessGroup: input.accessGroup ?? null,
      publishedAt:
        input.status === "published" ? asDate(input.date, now) : null,
      revision: 1,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    if (variant) {
      await tx.insert(schema.postVariants).values({
        id: randomUUID(),
        postId: id,
        locale: variant.locale,
        title: variant.title,
        excerpt: variant.excerpt ?? "",
        bodyMdx: variant.bodyMdx ?? "",
        originLocale: variant.originLocale ?? null,
        translationState: variant.translationState ?? "source",
        checksum: checksum(variant.bodyMdx ?? ""),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (tags.length > 0) {
      await tx
        .insert(schema.postTags)
        .values(tags.map((tag) => ({ postId: id, tag })));
    }
    await tx.insert(schema.postRevisions).values({
      id: randomUUID(),
      postId: id,
      revision: 1,
      snapshot: { input },
      createdBy: actorId,
      createdAt: now,
    });
  });
  return findPost(id, true);
}

export async function updatePost(
  id: string,
  input: Omit<Partial<Omit<PostInput, "variant">>, "accessGroup"> & {
    accessGroup?: string | null;
  },
  actorId: string,
  expectedRevision?: number,
) {
  const database = getCoreDb();
  const now = new Date();
  const revisionPredicate =
    expectedRevision === undefined
      ? eq(schema.posts.id, id)
      : and(
          eq(schema.posts.id, id),
          eq(schema.posts.revision, expectedRevision),
        );
  const updated = await database
    .update(schema.posts)
    .set({
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.sourceLocale ? { sourceLocale: input.sourceLocale } : {}),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.accessMode ? { accessMode: input.accessMode } : {}),
      ...(input.accessGroup === undefined
        ? {}
        : { accessGroup: input.accessGroup ?? null }),
      ...(input.status === "published" ? { publishedAt: now } : {}),
      revision: sql`${schema.posts.revision} + 1`,
      updatedBy: actorId,
      updatedAt: now,
    })
    .where(revisionPredicate)
    .returning({ id: schema.posts.id });
  if (updated.length === 0) {
    const existing = await findPost(id, false);
    if (!existing) return null;
    const error = new Error("The resource changed since it was loaded.");
    error.name = "RevisionConflict";
    throw error;
  }
  if (input.tags) {
    const tags = normalizeTags(input.tags);
    await database.transaction(async (tx) => {
      await tx.delete(schema.postTags).where(eq(schema.postTags.postId, id));
      if (tags.length > 0)
        await tx
          .insert(schema.postTags)
          .values(tags.map((tag) => ({ postId: id, tag })));
    });
  }
  return findPost(id, true);
}

export async function upsertPostVariant(
  id: string,
  locale: string,
  input: Omit<PostVariantInput, "locale">,
  actorId: string,
  expectedRevision?: number,
) {
  const database = getCoreDb();
  const post = await findPost(id, false);
  if (!post) return null;
  const [existing] = await database
    .select()
    .from(schema.postVariants)
    .where(
      and(
        eq(schema.postVariants.postId, id),
        eq(schema.postVariants.locale, locale),
      ),
    )
    .limit(1);
  if (
    existing &&
    expectedRevision !== undefined &&
    existing.revision !== expectedRevision
  ) {
    const error = new Error("The resource changed since it was loaded.");
    error.name = "RevisionConflict";
    throw error;
  }
  if (existing && expectedRevision === undefined) {
    const error = new Error("If-Match is required for edits.");
    error.name = "PreconditionRequired";
    throw error;
  }
  const now = new Date();
  if (existing) {
    await database
      .update(schema.postVariants)
      .set({
        title: input.title,
        excerpt: input.excerpt ?? "",
        bodyMdx: input.bodyMdx ?? "",
        originLocale: input.originLocale ?? null,
        translationState: input.translationState ?? "source",
        checksum: checksum(input.bodyMdx ?? ""),
        revision: sql`${schema.postVariants.revision} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.postVariants.id, existing.id));
  } else {
    await database.insert(schema.postVariants).values({
      id: randomUUID(),
      postId: id,
      locale,
      title: input.title,
      excerpt: input.excerpt ?? "",
      bodyMdx: input.bodyMdx ?? "",
      originLocale: input.originLocale ?? null,
      translationState: input.translationState ?? "source",
      checksum: checksum(input.bodyMdx ?? ""),
      createdAt: now,
      updatedAt: now,
    });
  }
  await database
    .update(schema.posts)
    .set({
      revision: sql`${schema.posts.revision} + 1`,
      updatedBy: actorId,
      updatedAt: now,
    })
    .where(eq(schema.posts.id, id));
  return findPostVariant(id, locale);
}

export async function deletePost(id: string, expectedRevision?: number) {
  const database = getCoreDb();
  const predicate =
    expectedRevision === undefined
      ? eq(schema.posts.id, id)
      : and(
          eq(schema.posts.id, id),
          eq(schema.posts.revision, expectedRevision),
        );
  const deleted = await database
    .delete(schema.posts)
    .where(predicate)
    .returning({ id: schema.posts.id });
  if (deleted.length === 0) {
    const existing = await findPost(id, false);
    if (!existing) return null;
    const error = new Error("The resource changed since it was loaded.");
    error.name = "RevisionConflict";
    throw error;
  }
  return { id };
}

async function tweetView(
  database: CoreDb,
  row: typeof schema.tweets.$inferSelect,
) {
  const variants = await database
    .select()
    .from(schema.tweetVariants)
    .where(eq(schema.tweetVariants.tweetId, row.id))
    .orderBy(asc(schema.tweetVariants.locale));
  const source =
    variants.find((variant) => variant.locale === "source") ?? variants[0];
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    createdAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    content: source?.body ?? "",
    lang:
      source?.originLocale ??
      (source?.locale === "source" ? undefined : source?.locale),
    tags: Array.isArray(row.tags) ? row.tags : [],
    visibility: row.visibility,
    pinned: row.pinned,
    translations: Object.fromEntries(
      variants
        .filter((variant) => variant.locale !== "source")
        .map((variant) => [
          variant.locale,
          {
            content: variant.body,
            sourceLang: source?.locale ?? "other",
            translatedAt: variant.updatedAt.toISOString(),
            model: "core-db",
            promptKey: `translate-to-${variant.locale}`,
            stale: variant.translationState === "stale",
          },
        ]),
    ),
    ...(row.origin ? { origin: row.origin } : {}),
    revision: row.revision,
  };
}

export async function listTweets() {
  const database = getCoreDb();
  const rows = await database
    .select()
    .from(schema.tweets)
    .orderBy(desc(schema.tweets.publishedAt));
  return Promise.all(rows.map((row) => tweetView(database, row)));
}

export async function createTweet(input: TweetInput, actorId: string) {
  const database = getCoreDb();
  const now = new Date();
  const publishedAt = asDate(input.publishedAt, now);
  const id = randomUUID();
  await database.transaction(async (tx) => {
    await tx.insert(schema.tweets).values({
      id,
      source: input.source ?? "manual",
      externalId: input.externalId ?? null,
      visible: input.visibility !== "hidden",
      visibility: input.visibility ?? "public",
      pinned: input.pinned ?? false,
      publishedAt,
      revision: 1,
      createdBy: actorId,
      updatedBy: actorId,
      origin: input.origin ?? null,
      tags: normalizeTags(input.tags),
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.tweetVariants).values({
      tweetId: id,
      locale: "source",
      body: input.content.trim(),
      originLocale: input.locale ?? null,
      translationState: "source",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  });
  return (await listTweets()).find((tweet) => tweet.id === id) ?? null;
}

export async function updateTweet(
  id: string,
  input: Partial<TweetInput>,
  actorId: string,
  expectedRevision?: number,
) {
  const database = getCoreDb();
  const current = await database
    .select()
    .from(schema.tweets)
    .where(eq(schema.tweets.id, id))
    .limit(1);
  if (current.length === 0) return null;
  if (
    expectedRevision !== undefined &&
    current[0].revision !== expectedRevision
  ) {
    const error = new Error("The resource changed since it was loaded.");
    error.name = "RevisionConflict";
    throw error;
  }
  const now = new Date();
  await database
    .update(schema.tweets)
    .set({
      ...(input.visibility
        ? {
            visibility: input.visibility,
            visible: input.visibility !== "hidden",
          }
        : {}),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.tags ? { tags: normalizeTags(input.tags) } : {}),
      ...(input.publishedAt ? { publishedAt: asDate(input.publishedAt) } : {}),
      revision: sql`${schema.tweets.revision} + 1`,
      updatedBy: actorId,
      updatedAt: now,
    })
    .where(eq(schema.tweets.id, id));
  if (input.content !== undefined || input.locale !== undefined) {
    await database
      .update(schema.tweetVariants)
      .set({
        ...(input.content === undefined ? {} : { body: input.content.trim() }),
        ...(input.locale === undefined ? {} : { originLocale: input.locale }),
        translationState: "stale",
        revision: sql`${schema.tweetVariants.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.tweetVariants.tweetId, id),
          eq(schema.tweetVariants.locale, "source"),
        ),
      );
  }
  return (await listTweets()).find((tweet) => tweet.id === id) ?? null;
}

export async function deleteTweet(id: string, expectedRevision?: number) {
  const database = getCoreDb();
  const predicate =
    expectedRevision === undefined
      ? eq(schema.tweets.id, id)
      : and(
          eq(schema.tweets.id, id),
          eq(schema.tweets.revision, expectedRevision),
        );
  const deleted = await database
    .delete(schema.tweets)
    .where(predicate)
    .returning({ id: schema.tweets.id });
  if (deleted.length === 0) {
    const existing = await database
      .select({ id: schema.tweets.id })
      .from(schema.tweets)
      .where(eq(schema.tweets.id, id))
      .limit(1);
    if (existing.length === 0) return null;
    const error = new Error("The resource changed since it was loaded.");
    error.name = "RevisionConflict";
    throw error;
  }
  return { id };
}
