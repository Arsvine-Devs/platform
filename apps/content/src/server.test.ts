import { afterEach, describe, expect, it, vi } from "vitest";

import { buildContentServer } from "./server.js";

const POINTER_KEY = "realm-content/current.json";
const RELEASE_ID = "release-1";
const RELEASE_PREFIX = `realm-content/releases/${RELEASE_ID}`;
const MANIFEST_KEY = `${RELEASE_PREFIX}/manifest.json`;
const POSTS_INDEX_KEY = `${RELEASE_PREFIX}/posts/index.json`;
const TWEET_INDEX_KEY = `${RELEASE_PREFIX}/tweets/index.json`;

function createStorage() {
  const objects = new Map<string, string>([
    [
      POINTER_KEY,
      JSON.stringify({
        schemaVersion: 1,
        releaseId: RELEASE_ID,
        publishedAt: "2026-09-15T00:00:00.000Z",
        manifest: MANIFEST_KEY,
      }),
    ],
    [
      MANIFEST_KEY,
      JSON.stringify({
        schemaVersion: 1,
        releaseId: RELEASE_ID,
        posts: { index: POSTS_INDEX_KEY },
        tweets: { index: TWEET_INDEX_KEY },
      }),
    ],
    [
      POSTS_INDEX_KEY,
      JSON.stringify({
        posts: [
          {
            slug: "public-post",
            date: "2026-09-14",
            access: { mode: "public" },
            variants: {
              "zh-CN": {
                key: `${RELEASE_PREFIX}/posts/public-post/zh-CN.json`,
              },
            },
          },
          {
            slug: "private-post",
            date: "2026-09-14",
            tags: ["private"],
            access: { mode: "totp", group: "family" },
            availableLocales: ["zh-CN"],
            variants: {
              "zh-CN": {
                key: `${RELEASE_PREFIX}/posts/private-post/zh-CN.json`,
                title: "Private title",
                excerpt: "Private excerpt",
              },
            },
          },
        ],
      }),
    ],
    [
      TWEET_INDEX_KEY,
      JSON.stringify([
        {
          month: "2026-09",
          path: `${RELEASE_PREFIX}/tweets/2026-09.json`,
          count: 2,
        },
      ]),
    ],
    [
      `${RELEASE_PREFIX}/tweets/2026-09.json`,
      JSON.stringify([
        {
          id: "public",
          createdAt: "2026-09-01T00:00:00.000Z",
          content: "public",
        },
        {
          id: "private",
          createdAt: "2026-09-02T00:00:00.000Z",
          content: "private",
          visibility: "private",
        },
      ]),
    ],
  ]);

  return {
    getText: vi.fn(async (key: string) => {
      const value = objects.get(key);
      if (value === undefined) throw new Error(`Missing object: ${key}`);
      return value;
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("published Content server", () => {
  it("sanitizes protected post metadata on the public index", async () => {
    const app = buildContentServer({ storage: createStorage() });

    const response = await app.inject({ method: "GET", url: "/v1/posts" });
    const body = response.json() as { posts: Array<Record<string, unknown>> };
    const protectedPost = body.posts.find(
      (post) => post.slug === "private-post",
    );

    expect(response.statusCode).toBe(200);
    expect(protectedPost).toMatchObject({
      slug: "private-post",
      tags: [],
      availableLocales: ["zh-CN"],
    });
    expect(protectedPost).not.toHaveProperty("variants");
  });

  it("does not expose protected variants on the public variant route", async () => {
    const app = buildContentServer({ storage: createStorage() });

    const response = await app.inject({
      method: "GET",
      url: "/v1/posts/private-post/variants/zh-CN",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "PROTECTED_CONTENT" } });
  });

  it("filters non-public tweets from the published month response", async () => {
    const app = buildContentServer({ storage: createStorage() });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tweets/months/2026-09",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      month: "2026-09",
      tweets: [{ id: "public" }],
    });
  });
});
