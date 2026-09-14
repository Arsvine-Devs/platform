export type ContentStorage = {
  getText(key: string): Promise<string>;
};

export type CurrentPointer = {
  schemaVersion: 1;
  releaseId: string;
  publishedAt: string;
  manifest: string;
};

export type ReleasePostVariantDescriptor =
  | string
  | {
      key: string;
      title?: string;
      excerpt?: string;
      originLocale?: string;
    };

export type ReleasePost = {
  slug: string;
  title?: string;
  excerpt?: string;
  date?: string;
  tags?: string[];
  pinned?: boolean;
  access?: { mode: "public" | "totp"; group?: string };
  availableLocales?: string[];
  variants?: Record<string, ReleasePostVariantDescriptor>;
};

export type ReleaseManifest = {
  schemaVersion: 1;
  releaseId: string;
  publishedAt?: string;
  posts?: { index: string };
  postsIndex?: string;
};

export class ReleaseFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJson<T>(text: string, key: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ReleaseFormatError(`Published object is not valid JSON: ${key}`);
  }
}

function requireObjectKey(value: unknown, field: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("..")
  ) {
    throw new ReleaseFormatError(`Invalid published object key: ${field}`);
  }
  return value;
}

function readPointer(value: unknown): CurrentPointer {
  if (!isRecord(value))
    throw new ReleaseFormatError("Published pointer is invalid");
  if (value.schemaVersion !== 1 || typeof value.releaseId !== "string") {
    throw new ReleaseFormatError("Published pointer schema is unsupported");
  }
  if (typeof value.publishedAt !== "string") {
    throw new ReleaseFormatError("Published pointer timestamp is missing");
  }
  return {
    schemaVersion: 1,
    releaseId: value.releaseId,
    publishedAt: value.publishedAt,
    manifest: requireObjectKey(value.manifest, "manifest"),
  };
}

function readManifest(
  value: unknown,
  pointer: CurrentPointer,
): ReleaseManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new ReleaseFormatError("Published manifest schema is unsupported");
  }
  if (value.releaseId !== pointer.releaseId) {
    throw new ReleaseFormatError(
      "Published manifest release does not match pointer",
    );
  }
  const postsIndex = isRecord(value.posts)
    ? value.posts.index
    : value.postsIndex;
  if (postsIndex !== undefined) requireObjectKey(postsIndex, "posts index");
  return {
    schemaVersion: 1,
    releaseId: pointer.releaseId,
    ...(typeof value.publishedAt === "string"
      ? { publishedAt: value.publishedAt }
      : {}),
    ...(typeof postsIndex === "string" ? { posts: { index: postsIndex } } : {}),
  };
}

function readPosts(value: unknown): ReleasePost[] {
  const posts =
    isRecord(value) && Array.isArray(value.posts) ? value.posts : value;
  if (!Array.isArray(posts))
    throw new ReleaseFormatError("Published post index is invalid");
  return posts.filter(isRecord).map((post) => {
    if (typeof post.slug !== "string" || !post.slug) {
      throw new ReleaseFormatError("Published post slug is missing");
    }
    return post as unknown as ReleasePost;
  });
}

export async function readPublishedRelease(
  storage: ContentStorage,
  pointerKey: string,
) {
  const pointer = readPointer(
    readJson(await storage.getText(pointerKey), pointerKey),
  );
  const manifest = readManifest(
    readJson(await storage.getText(pointer.manifest), pointer.manifest),
    pointer,
  );
  const posts = manifest.posts
    ? readPosts(
        readJson(
          await storage.getText(manifest.posts.index),
          manifest.posts.index,
        ),
      )
    : [];
  return { pointer, manifest, posts };
}

export function findPublishedPost(posts: readonly ReleasePost[], slug: string) {
  return posts.find((post) => post.slug === slug) ?? null;
}

export function getVariantKey(post: ReleasePost, locale: string) {
  const descriptor = post.variants?.[locale];
  if (typeof descriptor === "string") return descriptor;
  return descriptor?.key ?? null;
}
