import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerContentRoutes } from "./content-routes.js";
import { buildApiServer } from "./server.js";

const { createPost } = vi.hoisted(() => ({ createPost: vi.fn() }));

vi.mock("@arsvine/core-db", async (original) => ({
  ...(await original<typeof import("@arsvine/core-db")>()),
  createPost,
}));

vi.mock("@arsvine/authz", async (original) => ({
  ...(await original<typeof import("@arsvine/authz")>()),
  verifyAccessToken: async () => ({
    subject: "fixture",
    scopes: ["content:read"],
    claims: {},
  }),
}));

it("forbids caching both authenticated and rejected account responses", async () => {
  const app = buildApiServer();
  try {
    const anonymous = await app.inject({ url: "/v1/me" });
    const authenticated = await app.inject({
      url: "/v1/me",
      headers: { authorization: "Bearer fixture" },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(authenticated.statusCode).toBe(200);
    for (const response of [anonymous, authenticated]) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  } finally {
    await app.close();
  }
});

describe("Core post publication", () => {
  it("requires publishing permission and sends all language variants in one write", async () => {
    const app = Fastify();
    registerContentRoutes(app, async (request) => {
      request.authPrincipal = {
        subject: "fixture",
        scopes: [
          "content:write",
          ...(request.headers["x-test-publisher"] ? ["content:publish"] : []),
        ],
        claims: {},
      };
    });
    const options = {
      method: "POST" as const,
      url: "/v1/posts",
      payload: {
        slug: "transaction-example",
        status: "published",
        variants: [
          { locale: "zh-CN", title: "示例", bodyMdx: "中文内容" },
          { locale: "en", title: "Example", bodyMdx: "English content" },
        ],
      },
    };

    const denied = await app.inject(options);
    expect(denied.statusCode).toBe(403);
    expect(createPost).not.toHaveBeenCalled();

    createPost.mockResolvedValueOnce({ revision: 1 });
    const published = await app.inject({
      ...options,
      headers: { "x-test-publisher": "1" },
    });
    expect(published.statusCode).toBe(201);
    expect(createPost).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: "published",
        variants: options.payload.variants,
      }),
      "fixture",
    );
    await app.close();
  });
});
