import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPostsMock, listTweetsMock } = vi.hoisted(() => ({
  listPostsMock: vi.fn(),
  listTweetsMock: vi.fn(),
}));

vi.mock("@arsvine/core-db", () => ({
  listPosts: listPostsMock,
  listTweets: listTweetsMock,
}));

import { publishCoreRelease } from "./publication.js";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CONTENT_PUBLISH_TOKEN", "content-publish-token");
  vi.stubEnv("REVALIDATE_WEBHOOK_SECRET", "revalidation-secret");
  listPostsMock.mockResolvedValue([
    {
      slug: "hello-world",
      status: "published",
      tags: ["news"],
      pinned: false,
      accessMode: "public",
      accessGroup: null,
      publishedAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
      variants: [
        {
          locale: "zh-CN",
          title: "你好",
          excerpt: "摘要",
          bodyMdx: "# 你好",
          originLocale: null,
        },
      ],
    },
  ]);
  listTweetsMock.mockResolvedValue([]);
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input).includes("/v1/internal/publications")) {
      const body = JSON.parse(String(init?.body)) as { releaseId: string };
      return new Response(JSON.stringify({ releaseId: body.releaseId }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ revalidated: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  listPostsMock.mockReset();
  listTweetsMock.mockReset();
});

describe("publishCoreRelease", () => {
  it("keeps drafts and private tweets out of published storage", async () => {
    const [published] = await listPostsMock();
    listPostsMock.mockResolvedValue([
      published,
      { ...published, slug: "draft-entry", status: "draft" },
    ]);
    const tweet = {
      createdAt: "2026-11-20T05:00:00.000Z",
      updatedAt: "2026-11-20T05:00:00.000Z",
    };
    listTweetsMock.mockResolvedValue([
      { ...tweet, visibility: "public", content: "public-preview" },
      { ...tweet, visibility: "private", content: "private-preview" },
    ]);
    await publishCoreRelease();
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("hello-world");
    expect(body).toContain("public-preview");
    expect(body).not.toContain("draft-entry");
    expect(body).not.toContain("private-preview");
  });

  it("publishes an empty replacement snapshot and confirms signed Realm revalidation", async () => {
    listPostsMock.mockResolvedValue([]);
    const resultPromise = publishCoreRelease();
    const result = await resultPromise;
    const calls = fetchMock.mock.calls;
    const publishCall = calls[0];
    const revalidationCall = calls[1];
    const revalidationBody = String(revalidationCall?.[1]?.body);
    const timestamp = String(
      new Headers(revalidationCall?.[1]?.headers).get("x-arsvine-timestamp"),
    );
    const signature = createHmac("sha256", "revalidation-secret")
      .update(`${timestamp}.${revalidationBody}`)
      .digest("hex");

    expect(result.realmRevalidated).toBe(true);
    expect(result.postCount).toBe(0);
    expect(String(publishCall?.[0])).toBe(
      "https://content.arsvine.com/v1/internal/publications",
    );
    expect(
      new Headers(publishCall?.[1]?.headers).get("x-publication-token"),
    ).toBe("content-publish-token");
    expect(String(revalidationCall?.[0])).toBe(
      "https://arsvine.com/api/internal/revalidate",
    );
    expect(timestamp).toMatch(/^\d{13}$/);
    expect(
      new Headers(revalidationCall?.[1]?.headers).get("x-arsvine-signature"),
    ).toBe(signature);
    expect(JSON.parse(revalidationBody)).toEqual({
      event: "content.published",
      releaseId: result.releaseId,
      timestamp: expect.any(String),
    });
  });
});
