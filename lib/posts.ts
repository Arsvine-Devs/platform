import matter from 'gray-matter';
import {
  GitHubError,
  getFile,
  listBlogVariantPaths,
  putFile,
  triggerPublicRevalidate,
} from './github';
import { validateAccessGroup, validateBlogSlug, sanitizeCommitMessage } from './input-validation';

import {
  BLOG_LOCALES,
  type BlogAccessMode,
  type BlogIndexItem,
  type BlogIndexVariant,
  type BlogLocale,
  type BlogPublishBatchInput,
  type BlogPublishInput,
  type BlogPublishVariantInput,
} from './admin-api/contracts';

type AccessMode = BlogAccessMode;

type BlogIndex = {
  version: number;
  updatedAt: string;
  posts: BlogIndexItem[];
};

type BlogVariantDocument = {
  path: string;
  locale: BlogLocale;
  sha?: string;
  content: string;
  data: {
    title?: string;
    excerpt?: string;
    date?: string;
    tags?: string[];
    pinned?: boolean;
    originLocale?: BlogLocale;
    updated?: string;
    updatedAt?: string;
    access?: { mode?: AccessMode; group?: string };
  };
};

function normalizeSlug(value: string) {
  // Stricter than the legacy `[a-z0-9-]+` regex — disallows leading,
  // trailing, and consecutive hyphens, plus a hard length cap.
  return validateBlogSlug(value);
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Date must use YYYY-MM-DD.');
  }
  return trimmed;
}

function normalizeLocale(value: string): BlogLocale {
  if ((BLOG_LOCALES as readonly string[]).includes(value)) {
    return value as BlogLocale;
  }
  throw new Error(`Unsupported locale: ${value}`);
}

function normalizeTags(rawTags: string[]) {
  return [...new Set(rawTags.map((tag) => tag.trim()).filter(Boolean))];
}

function buildVariantPath(slug: string, locale: BlogLocale) {
  return `blog/${slug}/${locale}.mdx`;
}

function buildAccess(accessMode: AccessMode, accessGroup?: string) {
  if (accessMode === 'totp') {
    if (accessGroup === undefined || accessGroup === null) {
      throw new Error('Protected posts require an access group.');
    }
    // White-list characters; rejects spaces, control chars, slashes, and
    // anything that could confuse a cookie name or TOTP config map key.
    return { mode: 'totp' as const, group: validateAccessGroup(accessGroup) };
  }

  return { mode: 'public' as const };
}

function buildMarkdown(input: {
  title: string;
  excerpt: string;
  date: string;
  tags: string[];
  pinned: boolean;
  originLocale?: BlogLocale;
  access: { mode: AccessMode; group?: string };
  updated: string;
  content: string;
}) {
  return matter.stringify(input.content.trim() + '\n', {
    title: input.title.trim(),
    date: input.date,
    excerpt: input.excerpt.trim(),
    tags: input.tags,
    pinned: input.pinned,
    ...(input.originLocale ? { originLocale: input.originLocale } : {}),
    updated: input.updated,
    access:
      input.access.mode === 'totp'
        ? { mode: 'totp', group: input.access.group || '' }
        : { mode: 'public' },
  });
}

async function readBlogVariant(path: string): Promise<BlogVariantDocument> {
  const file = await getFile(path);
  if (!file) {
    throw new Error(`Missing blog variant file: ${path}`);
  }

  const locale = normalizeLocale(
    path
      .split('/')
      .pop()
      ?.replace(/\.mdx$/, '') || '',
  );
  const parsed = matter(file.content);

  return {
    path,
    locale,
    sha: file.sha,
    content: parsed.content,
    data: parsed.data as BlogVariantDocument['data'],
  };
}

async function readExistingVariants(slug: string) {
  const paths = await listBlogVariantPaths();
  const variantPaths = paths.filter((path) => path.startsWith(`blog/${slug}/`));
  return Promise.all(variantPaths.map((path) => readBlogVariant(path)));
}

async function writeFileWithConflictRetry(params: {
  path: string;
  content: string;
  message: string;
  sha?: string;
}) {
  try {
    return await putFile(params);
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 409) {
      throw error;
    }

    const latest = await getFile(params.path);
    return putFile({
      ...params,
      sha: latest?.sha,
    });
  }
}

function toIndexItem(slug: string, docs: BlogVariantDocument[]): BlogIndexItem {
  const preferredDoc =
    docs.find((doc) => doc.locale === 'zh-CN') ??
    docs.find((doc) => doc.locale === 'en') ??
    docs[0];

  if (!preferredDoc) {
    throw new Error(`No variants found for slug: ${slug}`);
  }

  const date = normalizeDate(
    typeof preferredDoc.data.date === 'string'
      ? preferredDoc.data.date
      : new Date().toISOString().slice(0, 10),
  );
  const updatedAt =
    typeof preferredDoc.data.updated === 'string' && preferredDoc.data.updated.trim()
      ? preferredDoc.data.updated.trim()
      : typeof preferredDoc.data.updatedAt === 'string' && preferredDoc.data.updatedAt.trim()
        ? preferredDoc.data.updatedAt.trim()
        : new Date(`${date}T00:00:00.000Z`).toISOString();

  const tags = normalizeTags(Array.isArray(preferredDoc.data.tags) ? preferredDoc.data.tags : []);
  const pinned = Boolean(preferredDoc.data.pinned);
  const access =
    preferredDoc.data.access?.mode === 'totp'
      ? {
          mode: 'totp' as const,
          group: preferredDoc.data.access.group?.trim() || undefined,
        }
      : { mode: 'public' as const };

  const variants = docs.reduce<Partial<Record<BlogLocale, BlogIndexVariant>>>((acc, doc) => {
    acc[doc.locale] = {
      title:
        typeof doc.data.title === 'string' && doc.data.title.trim() ? doc.data.title.trim() : slug,
      excerpt:
        typeof doc.data.excerpt === 'string' && doc.data.excerpt.trim()
          ? doc.data.excerpt.trim()
          : '',
      tags: normalizeTags(Array.isArray(doc.data.tags) ? doc.data.tags : []),
      ...(doc.data.originLocale ? { originLocale: doc.data.originLocale } : {}),
    };
    return acc;
  }, {});

  const availableLocales = docs
    .map((doc) => doc.locale)
    .sort((left, right) => BLOG_LOCALES.indexOf(left) - BLOG_LOCALES.indexOf(right));

  return {
    slug,
    date,
    updatedAt,
    tags,
    pinned,
    access,
    availableLocales,
    variants,
  };
}

export async function rebuildBlogIndex(slug?: string) {
  const paths = await listBlogVariantPaths();
  const grouped = new Map<string, string[]>();

  for (const path of paths) {
    const [, slug] = path.split('/');
    if (!slug) continue;
    const current = grouped.get(slug) ?? [];
    current.push(path);
    grouped.set(slug, current);
  }

  const entries = await Promise.all(
    [...grouped.entries()].map(async ([slug, variantPaths]) => {
      const docs = await Promise.all(variantPaths.map((path) => readBlogVariant(path)));
      return toIndexItem(slug, docs);
    }),
  );

  entries.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const index: BlogIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    posts: entries,
  };

  const existing = await getFile('blog-index.json');
  await putFile({
    path: 'blog-index.json',
    content: `${JSON.stringify(index, null, 2)}\n`,
    message: sanitizeCommitMessage('Rebuild blog index'),
    sha: existing?.sha,
  });

  const revalidated = await triggerPublicRevalidate(slug);
  return { index, revalidated };
}

export async function getBlogIndex() {
  const indexFile = await getFile('blog-index.json');
  if (!indexFile?.content.trim()) {
    return { version: 1, updatedAt: new Date(0).toISOString(), posts: [] } satisfies BlogIndex;
  }

  try {
    return JSON.parse(indexFile.content) as BlogIndex;
  } catch {
    throw new Error('Invalid blog-index.json');
  }
}

export async function getBlogVariant(slug: string, locale: string) {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedLocale = normalizeLocale(locale);
  const path = buildVariantPath(normalizedSlug, normalizedLocale);
  const file = await getFile(path);

  if (!file) {
    return null;
  }

  const parsed = matter(file.content);
  const data = parsed.data as BlogVariantDocument['data'];

  return {
    slug: normalizedSlug,
    locale: normalizedLocale,
    title: typeof data.title === 'string' ? data.title : '',
    excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
    date: typeof data.date === 'string' ? data.date : '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    pinned: Boolean(data.pinned),
    accessMode: data.access?.mode === 'totp' ? ('totp' as const) : ('public' as const),
    accessGroup: data.access?.group?.trim() || '',
    originLocale: data.originLocale || '',
    content: parsed.content,
  };
}

export async function publishPost(input: BlogPublishInput) {
  const result = await publishPostBatch({
    slug: input.slug,
    date: input.date,
    pinned: input.pinned,
    accessMode: input.accessMode,
    accessGroup: input.accessGroup,
    variants: [
      {
        locale: input.locale,
        title: input.title,
        excerpt: input.excerpt,
        tags: input.tags,
        content: input.content,
        originLocale: input.originLocale,
      },
    ],
  });

  return {
    path: result.paths[0] ?? '',
    commits: result.commits,
    revalidated: result.revalidated,
  };
}

export async function publishPostBatch(input: BlogPublishBatchInput) {
  const slug = normalizeSlug(input.slug);
  const date = normalizeDate(input.date);
  const access = buildAccess(input.accessMode, input.accessGroup);
  const timestamp = new Date().toISOString();
  const existingVariants = await readExistingVariants(slug);
  const existingByLocale = new Map(existingVariants.map((variant) => [variant.locale, variant]));
  const requestedVariants = new Map<BlogLocale, BlogPublishVariantInput>();

  for (const variant of input.variants) {
    const locale = normalizeLocale(variant.locale);
    requestedVariants.set(locale, {
      ...variant,
      locale,
      tags: normalizeTags(variant.tags),
      originLocale:
        variant.originLocale && variant.originLocale !== locale
          ? normalizeLocale(variant.originLocale)
          : undefined,
    });
  }

  if (requestedVariants.size === 0) {
    throw new Error('At least one variant is required.');
  }

  const writes: Array<{ path: string; sha?: string; content: string; message: string }> = [];

  for (const locale of BLOG_LOCALES) {
    const requested = requestedVariants.get(locale);
    const existing = existingByLocale.get(locale);

    if (!requested && !existing) {
      continue;
    }

    const path = buildVariantPath(slug, locale);
    const content = buildMarkdown({
      title:
        requested?.title ??
        (typeof existing?.data.title === 'string' && existing.data.title.trim()
          ? existing.data.title
          : slug),
      excerpt:
        requested?.excerpt ??
        (typeof existing?.data.excerpt === 'string' && existing.data.excerpt.trim()
          ? existing.data.excerpt
          : ''),
      date,
      tags:
        requested?.tags ??
        (Array.isArray(existing?.data.tags) ? normalizeTags(existing.data.tags) : []),
      pinned: input.pinned,
      originLocale:
        requested?.originLocale ??
        (existing?.data.originLocale ? normalizeLocale(existing.data.originLocale) : undefined),
      access,
      updated: timestamp,
      content: requested?.content ?? existing?.content ?? '',
    });

    writes.push({
      path,
      sha: existing?.sha,
      message: sanitizeCommitMessage(
        `${existing?.sha ? 'Update' : 'Create'} blog variant: ${slug}/${locale}`,
      ),
      content,
    });
  }

  const commits = [];
  for (const write of writes) {
    commits.push(await writeFileWithConflictRetry(write));
  }

  const rebuilt = await rebuildBlogIndex(slug);

  return {
    paths: writes.map((write) => write.path),
    commits,
    revalidated: rebuilt.revalidated,
  };
}
