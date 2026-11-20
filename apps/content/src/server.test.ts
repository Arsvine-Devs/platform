import { describe, expect, it, vi } from "vitest";
import { buildContentServer } from "./server.js";

function fixture() {
  const date = "2026-11-18";
  const access = { mode: "totp" as const, group: "family" };
  const protectedPost = {
    slug: "protected",
    date,
    updatedAt: date + "T00:00:00Z",
    pinned: false,
    access,
    tags: [],
    availableLocales: ["zh-CN"],
  };
  return {
    ready: vi.fn(async () => {}),
    posts: vi.fn(async () => [protectedPost]),
    post: vi.fn(async () => protectedPost),
    variant: vi.fn(async () => null),
    tweetMonths: vi.fn(async () => []),
    tweets: vi.fn(async () => []),
  };
}

describe("published Content server", () => {
  it("reads current metadata on every request and uses no cache", async () => {
    const content = fixture();
    const app = buildContentServer(content);
    const first = await app.inject("/v1/posts");
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toMatchObject({
      posts: [{ slug: "protected", tags: [] }],
    });
    expect(first.json().posts[0]).not.toHaveProperty("variants");

    content.posts.mockResolvedValueOnce([]);
    const second = await app.inject("/v1/posts");
    expect(second.json()).toEqual({ posts: [] });
    expect(content.posts).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("keeps anonymous variants separate from the authenticated reader", async () => {
    const content = fixture();
    const app = buildContentServer(content);

    const publicRequest = await app.inject(
      "/v1/posts/protected/variants/zh-CN",
    );
    expect(publicRequest.statusCode).toBe(403);
    expect(publicRequest.json()).toEqual({
      error: { code: "PROTECTED_CONTENT" },
    });
    expect(content.variant).toHaveBeenCalledExactlyOnceWith(
      "protected",
      "zh-CN",
      "public",
    );

    const protectedRequest = await app.inject(
      "/v1/internal/posts/protected/variants/zh-CN",
    );
    expect(protectedRequest.statusCode).toBe(401);
    expect(content.variant).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("signals database failure and gives the next read a fresh attempt", async () => {
    const content = fixture();
    content.posts.mockRejectedValueOnce(new Error("database unreachable"));
    const app = buildContentServer(content);

    const unavailable = await app.inject("/v1/posts");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["cache-control"]).toBe("no-store");
    expect((await app.inject("/v1/posts")).statusCode).toBe(200);
    await app.close();
  });
});
