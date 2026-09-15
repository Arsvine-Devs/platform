import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    status: text("status").notNull().default("draft"),
    sourceLocale: text("source_locale").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    accessMode: text("access_mode").notNull().default("public"),
    accessGroup: text("access_group"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("posts_status_updated_idx").on(table.status, table.updatedAt),
    index("posts_source_locale_idx").on(table.sourceLocale),
    // Keep the access values constrained without coupling the application to a
    // generated PostgreSQL enum that would make future additive migrations harder.
    uniqueIndex("posts_slug_lower_idx").on(sql`lower(${table.slug})`),
  ],
);

export const postVariants = pgTable(
  "post_variants",
  {
    id: uuid("id").primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    bodyMdx: text("body_mdx").notNull().default(""),
    originLocale: text("origin_locale"),
    translationState: text("translation_state").notNull().default("source"),
    readingMinutes: integer("reading_minutes").notNull().default(0),
    checksum: text("checksum").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("post_variants_post_locale_idx").on(table.postId, table.locale),
    index("post_variants_locale_idx").on(table.locale),
  ],
);

export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [primaryKey({ columns: [table.postId, table.tag] })],
);

export const postRevisions = pgTable(
  "post_revisions",
  {
    id: uuid("id").primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("post_revisions_post_revision_idx").on(
      table.postId,
      table.revision,
    ),
  ],
);

export const tweets = pgTable(
  "tweets",
  {
    id: uuid("id").primaryKey(),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    visible: boolean("visible").notNull().default(true),
    visibility: text("visibility").notNull().default("public"),
    pinned: boolean("pinned").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    origin: jsonb("origin"),
    tags: jsonb("tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tweets_published_at_idx").on(table.publishedAt),
    uniqueIndex("tweets_external_id_idx").on(table.externalId),
  ],
);

export const tweetVariants = pgTable(
  "tweet_variants",
  {
    tweetId: uuid("tweet_id")
      .notNull()
      .references(() => tweets.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    body: text("body").notNull(),
    originLocale: text("origin_locale"),
    translationState: text("translation_state").notNull().default("source"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tweetId, table.locale] })],
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey(),
    releaseId: text("release_id").notNull().unique(),
    status: text("status").notNull().default("created"),
    sourceRevision: integer("source_revision").notNull(),
    manifestKey: text("manifest_key"),
    error: text("error"),
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (table) => [
    index("publications_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const publicationItems = pgTable(
  "publication_items",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.publicationId, table.resourceType, table.resourceId],
    }),
  ],
);
