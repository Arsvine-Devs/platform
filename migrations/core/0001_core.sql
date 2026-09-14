CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  source_locale text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  access_mode text NOT NULL DEFAULT 'public' CHECK (access_mode IN ('public', 'totp')),
  access_group text,
  published_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_slug_lower_idx ON posts (lower(slug));
CREATE INDEX IF NOT EXISTS posts_status_updated_idx ON posts (status, updated_at);

CREATE TABLE IF NOT EXISTS post_variants (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  locale text NOT NULL,
  title text NOT NULL,
  excerpt text NOT NULL DEFAULT '',
  body_mdx text NOT NULL DEFAULT '',
  origin_locale text,
  translation_state text NOT NULL DEFAULT 'source',
  reading_minutes integer NOT NULL DEFAULT 0,
  checksum text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, locale)
);
CREATE INDEX IF NOT EXISTS post_variants_locale_idx ON post_variants (locale);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (post_id, tag)
);

CREATE TABLE IF NOT EXISTS post_revisions (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, revision)
);

CREATE TABLE IF NOT EXISTS tweets (
  id uuid PRIMARY KEY,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'x')),
  external_id text UNIQUE,
  visible boolean NOT NULL DEFAULT true,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'hidden')),
  pinned boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  origin jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tweets_published_at_idx ON tweets (published_at);

CREATE TABLE IF NOT EXISTS tweet_variants (
  tweet_id uuid NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
  locale text NOT NULL,
  body text NOT NULL,
  origin_locale text,
  translation_state text NOT NULL DEFAULT 'source',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tweet_id, locale)
);

CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY,
  release_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'created',
  source_revision integer NOT NULL,
  manifest_key text,
  error text,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS publication_items (
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (publication_id, resource_type, resource_id)
);
