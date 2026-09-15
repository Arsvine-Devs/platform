import { NextResponse, type NextRequest } from 'next/server';
import { callControlApi, controlSuccess, isControlApiSuccess } from '../../../../lib/control-api';
import type { ApiPost, ApiTweet } from '@arsvine/contracts';
import type {
  BlogIndexData,
  BlogPublishBatchInput,
  BlogPublishInput,
  BlogVariantData,
  LibraryData,
} from '../../../../lib/admin-api/contracts';
import type { TweetItem, TweetsDashboardData } from '../../../../lib/tweets-types';

type Context = { params: Promise<{ path: string[] }> };

function bodyValue(result: unknown) {
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
}

function postIndexItem(post: ApiPost): BlogIndexData['posts'][number] {
  const date = (post.publishedAt ?? post.updatedAt).slice(0, 10);
  return {
    slug: post.slug,
    date,
    updatedAt: post.updatedAt,
    tags: post.tags,
    pinned: post.pinned,
    access: {
      mode: post.accessMode,
      ...(post.accessGroup ? { group: post.accessGroup } : {}),
    },
    availableLocales: post.variants.map(
      (variant) => variant.locale,
    ) as BlogIndexData['posts'][number]['availableLocales'],
    variants: Object.fromEntries(
      post.variants.map((variant) => [
        variant.locale,
        {
          title: variant.title,
          excerpt: variant.excerpt,
          ...(variant.originLocale
            ? {
                originLocale:
                  variant.originLocale as BlogIndexData['posts'][number]['availableLocales'][number],
              }
            : {}),
        },
      ]),
    ),
  };
}

function tweetMonth(tweet: ApiTweet) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(tweet.createdAt));
}

function tweetDashboard(tweets: ApiTweet[]): TweetsDashboardData {
  const grouped = new Map<string, ApiTweet[]>();
  for (const tweet of tweets) {
    const month = tweetMonth(tweet);
    const list = grouped.get(month) ?? [];
    list.push(tweet);
    grouped.set(month, list);
  }
  const toTweetItem = (tweet: ApiTweet): TweetItem => ({
    id: tweet.id,
    createdAt: tweet.createdAt,
    updatedAt: tweet.updatedAt,
    content: tweet.content,
    lang: tweet.lang,
    tags: tweet.tags,
    visibility: tweet.visibility,
    pinned: tweet.pinned,
    translations: tweet.translations as TweetItem['translations'],
    origin: tweet.origin as TweetItem['origin'],
  });
  const months = [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, entries]) => ({
      month,
      count: entries.length,
      updatedAt: entries
        .map((entry) => entry.updatedAt)
        .sort()
        .at(-1),
      tweets: entries
        .sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )
        .map(toTweetItem),
    }));
  return {
    months,
  };
}

async function get(request: NextRequest, segments: string[]) {
  const route = segments.join('/');
  if (route === 'library') {
    const [postsResult, tweetsResult] = await Promise.all([
      callControlApi(request, '/v1/posts'),
      callControlApi(request, '/v1/tweets'),
    ]);
    if (!isControlApiSuccess(postsResult)) return postsResult.response;
    if (!isControlApiSuccess(tweetsResult)) return tweetsResult.response;
    const posts = Array.isArray(bodyValue(postsResult.data).posts)
      ? (bodyValue(postsResult.data).posts as ApiPost[])
      : [];
    const tweets = Array.isArray(bodyValue(tweetsResult.data).tweets)
      ? (bodyValue(tweetsResult.data).tweets as ApiTweet[])
      : [];
    const data: LibraryData = {
      items: [
        ...posts.map((post) => ({
          id: `blog:${post.slug}`,
          type: 'blog' as const,
          title:
            post.variants.find((variant) => variant.locale === 'zh-CN')?.title ??
            post.variants[0]?.title ??
            post.slug,
          locale: post.variants.map((variant) => variant.locale).join(' · '),
          status: post.status === 'published' ? ('published' as const) : ('draft' as const),
          updatedAt: post.updatedAt,
          href: `/blog?slug=${encodeURIComponent(post.slug)}&locale=${encodeURIComponent(post.variants[0]?.locale ?? 'zh-CN')}`,
        })),
        ...tweets.map((tweet) => ({
          id: `tweet:${tweet.id}`,
          type: 'tweet' as const,
          title: tweet.content.replace(/\s+/g, ' ').slice(0, 90) || tweet.id,
          locale: tweet.lang ?? 'other',
          status: tweet.visibility === 'hidden' ? ('draft' as const) : ('published' as const),
          updatedAt: tweet.updatedAt,
          href: `/tweets?month=${encodeURIComponent(tweetMonth(tweet))}&id=${encodeURIComponent(tweet.id)}`,
        })),
      ].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    };
    return controlSuccess(postsResult, data);
  }

  if (route === 'blog-index') {
    const result = await callControlApi(request, '/v1/posts');
    if (!isControlApiSuccess(result)) return result.response;
    const posts = Array.isArray(bodyValue(result.data).posts)
      ? (bodyValue(result.data).posts as ApiPost[])
      : [];
    const data: BlogIndexData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      posts: posts.map(postIndexItem),
    };
    return controlSuccess(result, data);
  }

  if (route === 'blog-variant') {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug')?.trim();
    const locale = url.searchParams.get('locale')?.trim();
    if (!slug || !locale)
      return NextResponse.json(
        { ok: false, error: { message: 'Missing slug or locale.' } },
        { status: 400 },
      );
    const result = await callControlApi(
      request,
      `/v1/posts/${encodeURIComponent(slug)}/variants/${encodeURIComponent(locale)}`,
    );
    if (!isControlApiSuccess(result)) return result.response;
    const body = bodyValue(result.data);
    const post = body.post as ApiPost;
    const variant = body.variant as ApiPost['variants'][number];
    const data: BlogVariantData = {
      slug: post.slug,
      locale: variant.locale as BlogVariantData['locale'],
      title: variant.title,
      excerpt: variant.excerpt,
      date: (post.publishedAt ?? post.updatedAt).slice(0, 10),
      tags: post.tags,
      pinned: post.pinned,
      accessMode: post.accessMode,
      accessGroup: post.accessGroup ?? '',
      originLocale: variant.originLocale ?? '',
      content: variant.bodyMdx ?? '',
    };
    return controlSuccess(result, data);
  }

  if (route === 'tweets') {
    const result = await callControlApi(request, '/v1/tweets');
    if (!isControlApiSuccess(result)) return result.response;
    const tweets = Array.isArray(bodyValue(result.data).tweets)
      ? (bodyValue(result.data).tweets as ApiTweet[])
      : [];
    return controlSuccess(result, tweetDashboard(tweets));
  }

  const tweetMatch = /^tweets\/([^/]+)$/.exec(route);
  if (tweetMatch) {
    const result = await callControlApi(request, `/v1/tweets/${encodeURIComponent(tweetMatch[1])}`);
    if (!isControlApiSuccess(result)) return result.response;
    return controlSuccess(result, bodyValue(result.data).tweet);
  }

  return NextResponse.json(
    { ok: false, error: { message: 'Control route not found.' } },
    { status: 404 },
  );
}

async function mutation(request: NextRequest, segments: string[]) {
  const route = segments.join('/');
  const raw = await request.json().catch(() => ({}));
  const method = request.method;
  const requireCsrf = method !== 'GET';

  if (route === 'publish' || route === 'publish-batch') {
    const input = raw as BlogPublishInput | BlogPublishBatchInput;
    const slug = input.slug?.trim().toLowerCase();
    if (!slug)
      return NextResponse.json(
        { ok: false, error: { message: 'slug is required.' } },
        { status: 422 },
      );
    const existing = await callControlApi(request, `/v1/posts/${encodeURIComponent(slug)}`);
    if (!isControlApiSuccess(existing) && existing.response.status !== 404)
      return existing.response;
    let post: ApiPost | null = isControlApiSuccess(existing)
      ? (bodyValue(existing.data).post as ApiPost)
      : null;
    if (!post) {
      const first =
        route === 'publish'
          ? {
              locale: (input as BlogPublishInput).locale,
              title: (input as BlogPublishInput).title,
              excerpt: (input as BlogPublishInput).excerpt,
              content: (input as BlogPublishInput).content,
              originLocale: (input as BlogPublishInput).originLocale,
            }
          : (input as BlogPublishBatchInput).variants[0];
      const created = await callControlApi(request, '/v1/posts', {
        method: 'POST',
        requireCsrf,
        body: {
          slug,
          sourceLocale: 'zh-CN',
          status: 'published',
          pinned: input.pinned,
          accessMode: input.accessMode,
          accessGroup: input.accessGroup,
          tags:
            route === 'publish'
              ? (input as BlogPublishInput).tags
              : (input as BlogPublishBatchInput).variants[0]?.tags,
          variant: first
            ? {
                locale: first.locale,
                title: first.title,
                excerpt: first.excerpt,
                bodyMdx: first.content,
                originLocale: first.originLocale,
              }
            : undefined,
        },
      });
      if (!isControlApiSuccess(created)) return created.response;
      post = bodyValue(created.data).post as ApiPost;
    } else {
      const updated = await callControlApi(request, `/v1/posts/${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        requireCsrf,
        body: {
          status: 'published',
          pinned: input.pinned,
          accessMode: input.accessMode,
          accessGroup: input.accessGroup,
          tags:
            route === 'publish'
              ? (input as BlogPublishInput).tags
              : (input as BlogPublishBatchInput).variants[0]?.tags,
        },
        headers: { 'If-Match': `"${post.revision}"` },
      });
      if (!isControlApiSuccess(updated)) return updated.response;
      post = bodyValue(updated.data).post as ApiPost;
    }
    const variants =
      route === 'publish'
        ? [
            {
              locale: (input as BlogPublishInput).locale,
              title: (input as BlogPublishInput).title,
              excerpt: (input as BlogPublishInput).excerpt,
              content: (input as BlogPublishInput).content,
              originLocale: (input as BlogPublishInput).originLocale,
            },
          ]
        : (input as BlogPublishBatchInput).variants.map((variant) => ({
            locale: variant.locale,
            title: variant.title,
            excerpt: variant.excerpt,
            content: variant.content,
            originLocale: variant.originLocale,
          }));
    for (const variant of variants) {
      const saved = await callControlApi(
        request,
        `/v1/posts/${encodeURIComponent(post.id)}/variants/${encodeURIComponent(variant.locale)}`,
        {
          method: 'PUT',
          requireCsrf,
          body: {
            title: variant.title,
            excerpt: variant.excerpt,
            bodyMdx: variant.content,
            originLocale: variant.originLocale,
          },
          headers: (() => {
            const previous = post.variants.find((candidate) => candidate.locale === variant.locale);
            return previous ? { 'If-Match': `"${previous.revision}"` } : undefined;
          })(),
        },
      );
      if (!isControlApiSuccess(saved)) return saved.response;
    }
    const publication = await callControlApi(request, '/v1/publications', {
      method: 'POST',
      requireCsrf,
      body: { idempotencyKey: request.headers.get('idempotency-key') ?? crypto.randomUUID() },
    });
    if (!isControlApiSuccess(publication)) return publication.response;
    return controlSuccess(publication, bodyValue(publication.data).publication);
  }

  if (route === 'tweets') {
    const result = await callControlApi(request, '/v1/tweets', {
      method: 'POST',
      requireCsrf,
      body: { ...raw, locale: raw.lang },
    });
    if (!isControlApiSuccess(result)) return result.response;
    return controlSuccess(
      result,
      {
        tweet: bodyValue(result.data).tweet,
        month: tweetMonth(bodyValue(result.data).tweet as ApiTweet),
      },
      201,
    );
  }

  const tweetMatch = /^tweets\/([^/]+)$/.exec(route);
  if (tweetMatch && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    const path = `/v1/tweets/${encodeURIComponent(tweetMatch[1])}`;
    const current = await callControlApi(request, path);
    if (!isControlApiSuccess(current)) return current.response;
    const currentTweet = bodyValue(current.data).tweet as ApiTweet;
    const result = await callControlApi(request, path, {
      method: method === 'PUT' ? 'PATCH' : method,
      requireCsrf,
      body: method === 'DELETE' ? undefined : { ...raw, locale: raw.lang },
      headers: { 'If-Match': `"${currentTweet.revision}"` },
    });
    if (!isControlApiSuccess(result)) return result.response;
    if (method === 'DELETE') return controlSuccess(result, { deletedId: tweetMatch[1] });
    const tweet = bodyValue(result.data).tweet as ApiTweet;
    return controlSuccess(result, { tweet, month: tweetMonth(tweet) });
  }

  return NextResponse.json(
    { ok: false, error: { message: 'Control route not found.' } },
    { status: 404 },
  );
}

export async function GET(request: NextRequest, context: Context) {
  return get(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: Context) {
  return mutation(request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: Context) {
  return mutation(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: Context) {
  return mutation(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: Context) {
  return mutation(request, (await context.params).path);
}
