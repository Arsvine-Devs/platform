CREATE OR REPLACE VIEW public.realm_published_posts
WITH (security_barrier = true) AS
SELECT
  post.slug,
  coalesce(post.published_at, post.updated_at) AS published_at,
  post.updated_at,
  post.pinned,
  post.access_mode,
  post.access_group,
  CASE WHEN post.access_mode = 'public'
    THEN ARRAY(SELECT tag FROM public.post_tags WHERE post_id = post.id ORDER BY tag)
    ELSE ARRAY[]::text[]
  END AS tags,
  variants.locales AS available_locales,
  CASE WHEN post.access_mode = 'public' THEN variants.metadata END AS variants
FROM public.posts AS post
CROSS JOIN LATERAL (
  SELECT array_agg(variant.locale ORDER BY variant.locale) AS locales,
    jsonb_object_agg(variant.locale, jsonb_strip_nulls(jsonb_build_object(
      'title', variant.title,
      'excerpt', variant.excerpt,
      'originLocale', variant.origin_locale
    ))) AS metadata
  FROM public.post_variants AS variant
  WHERE variant.post_id = post.id
) AS variants
WHERE post.status = 'published' AND variants.locales IS NOT NULL;

CREATE OR REPLACE VIEW public.realm_published_post_variants
WITH (security_barrier = true) AS
SELECT
  post.slug,
  variant.locale,
  variant.title,
  variant.excerpt,
  variant.body_mdx,
  variant.origin_locale,
  coalesce(post.published_at, post.updated_at) AS published_at,
  post.updated_at,
  post.access_mode,
  post.access_group,
  ARRAY(SELECT tag FROM public.post_tags WHERE post_id = post.id ORDER BY tag) AS tags
FROM public.posts AS post
JOIN public.post_variants AS variant ON variant.post_id = post.id
WHERE post.status = 'published';

CREATE OR REPLACE VIEW public.realm_public_tweets
WITH (security_barrier = true) AS
SELECT
  tweet.id,
  tweet.published_at AS created_at,
  tweet.updated_at,
  source.body AS content,
  source.origin_locale AS lang,
  tweet.tags,
  tweet.pinned,
  tweet.origin,
  coalesce((
    SELECT jsonb_object_agg(variant.locale, jsonb_build_object(
      'content', variant.body,
      'sourceLang', coalesce(source.origin_locale, 'other'),
      'translatedAt', variant.updated_at,
      'model', 'core-db',
      'promptKey', 'translate-to-' || variant.locale,
      'stale', variant.translation_state = 'stale'
    ))
    FROM public.tweet_variants AS variant
    WHERE variant.tweet_id = tweet.id AND variant.locale <> 'source'
  ), '{}'::jsonb) AS translations
FROM public.tweets AS tweet
JOIN public.tweet_variants AS source ON source.tweet_id = tweet.id AND source.locale = 'source'
WHERE tweet.visibility = 'public' AND tweet.visible;
