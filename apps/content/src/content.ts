import { getCoreDb } from "@arsvine/core-db";

type AccessMode = "public" | "totp";

type PostRow = {
  slug: string;
  published_at: Date;
  updated_at: Date;
  pinned: boolean;
  access_mode: AccessMode;
  access_group: string | null;
  tags: string[];
  available_locales: string[];
  variants: Record<
    string,
    { title: string; excerpt: string; originLocale?: string }
  > | null;
};

type VariantRow = {
  slug: string;
  locale: string;
  title: string;
  excerpt: string;
  body_mdx: string;
  origin_locale: string | null;
  published_at: Date;
  updated_at: Date;
  access_mode: AccessMode;
  access_group: string | null;
  tags: string[];
};

type TweetRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  content: string;
  lang: string | null;
  tags: string[];
  pinned: boolean;
  origin: Record<string, unknown> | null;
  translations: Record<string, unknown>;
};

function access(row: { access_mode: AccessMode; access_group: string | null }) {
  return {
    mode: row.access_mode,
    ...(row.access_mode === "totp" && row.access_group
      ? { group: row.access_group }
      : {}),
  };
}

function postMetadata(row: PostRow) {
  return {
    slug: row.slug,
    date: row.published_at.toISOString().slice(0, 10),
    updatedAt: row.updated_at.toISOString(),
    pinned: row.pinned,
    access: access(row),
    tags: row.tags,
    availableLocales: row.available_locales,
    ...(row.variants ? { variants: row.variants } : {}),
  };
}

const tweetMonth =
  "to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')";

export const publishedContent = {
  async ready() {
    const db = getCoreDb().$client;
    await db.query(`
      SELECT
        (SELECT slug FROM public.realm_published_posts LIMIT 1),
        (SELECT slug FROM public.realm_published_post_variants LIMIT 1),
        (SELECT id FROM public.realm_public_tweets LIMIT 1)
    `);
  },

  async posts() {
    const { rows } = await getCoreDb().$client.query<PostRow>(`
      SELECT * FROM public.realm_published_posts ORDER BY pinned DESC, published_at DESC, slug
    `);
    return rows.map(postMetadata);
  },

  async post(slug: string) {
    const { rows } = await getCoreDb().$client.query<PostRow>(
      "SELECT * FROM public.realm_published_posts WHERE slug = $1",
      [slug],
    );
    return rows[0] ? postMetadata(rows[0]) : null;
  },

  async variant(slug: string, locale: string, mode: AccessMode) {
    const {
      rows: [row],
    } = await getCoreDb().$client.query<VariantRow>(
      `SELECT * FROM public.realm_published_post_variants
       WHERE slug = $1 AND locale = $2 AND access_mode = $3`,
      [slug, locale, mode],
    );
    return row
      ? {
          slug: row.slug,
          locale: row.locale,
          title: row.title,
          excerpt: row.excerpt,
          bodyMdx: row.body_mdx,
          ...(row.origin_locale ? { originLocale: row.origin_locale } : {}),
          date: row.published_at.toISOString().slice(0, 10),
          updatedAt: row.updated_at.toISOString(),
          access: access(row),
          tags: row.tags,
        }
      : null;
  },

  async tweetMonths() {
    const { rows } = await getCoreDb().$client.query<{
      month: string;
      count: number;
      updatedAt: Date;
    }>(`
      SELECT ${tweetMonth} AS month, count(*)::int AS count, max(updated_at) AS "updatedAt"
      FROM public.realm_public_tweets
      GROUP BY month ORDER BY month DESC
    `);
    return rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    }));
  },

  async tweets(month: string) {
    const { rows } = await getCoreDb().$client.query<TweetRow>(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", content, lang,
         tags, pinned, origin, translations
       FROM public.realm_public_tweets WHERE ${tweetMonth} = $1
       ORDER BY pinned DESC, created_at DESC, id`,
      [month],
    );
    return rows.map(({ lang, origin, createdAt, updatedAt, ...row }) => ({
      ...row,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      ...(lang ? { lang } : {}),
      ...(origin ? { origin } : {}),
    }));
  },
};
