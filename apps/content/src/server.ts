import Fastify, { type FastifyReply } from "fastify";
import swagger from "@fastify/swagger";
import {
  readObjectStorageConfig,
  createObjectStorage,
} from "@arsvine/object-storage";
import { log } from "@arsvine/observability";
import {
  findPublishedPost,
  getVariantKey,
  readPublishedTweetMonth,
  readPublishedRelease,
  type ContentStorage,
} from "./release.js";

const currentPointerKey =
  process.env.CONTENT_CURRENT_POINTER ?? "realm-content/current.json";

type ContentServerOptions = {
  storage?: ContentStorage | null;
};

function notReady(reply: FastifyReply) {
  return reply.code(503).send({
    error: {
      code: "NOT_READY",
      message: "Published content storage is not ready.",
    },
  });
}

export function buildContentServer(options: ContentServerOptions = {}) {
  const app = Fastify({ logger: false });
  const displayName =
    process.env.CONTENT_DISPLAY_NAME?.trim() || "Published Content";
  const publicUrl = process.env.CONTENT_PUBLIC_URL?.trim();

  app.register(swagger, {
    openapi: {
      info: { title: displayName, version: "0.1.0" },
      ...(publicUrl ? { servers: [{ url: publicUrl }] } : {}),
    },
  });

  app.get("/health/live", async () => ({ status: "live", service: "content" }));
  app.get("/health/ready", async (_request, reply) => {
    const storage =
      options.storage ??
      (() => {
        const config = readObjectStorageConfig();
        return config ? createObjectStorage(config) : null;
      })();
    if (!storage)
      return reply.code(503).send({ status: "not_ready", service: "content" });

    try {
      await readPublishedRelease(storage, currentPointerKey);
      return { status: "ready", service: "content" };
    } catch {
      return reply.code(503).send({ status: "not_ready", service: "content" });
    }
  });

  app.get("/v1/posts", async (_request, reply) => {
    const storage =
      options.storage ??
      (() => {
        const config = readObjectStorageConfig();
        return config ? createObjectStorage(config) : null;
      })();
    if (!storage) return notReady(reply);
    try {
      const release = await readPublishedRelease(storage, currentPointerKey);
      log("info", {
        service: "content",
        operation: "posts.read",
        releaseId: release.pointer.releaseId,
      });
      reply
        .header("ETag", `"${release.pointer.releaseId}"`)
        .header("Last-Modified", release.pointer.publishedAt)
        .header(
          "Cache-Control",
          "public, max-age=60, stale-while-revalidate=300",
        )
        .header("X-Arsvine-Content-Release", release.pointer.releaseId);
      return {
        releaseId: release.pointer.releaseId,
        publishedAt: release.pointer.publishedAt,
        posts: release.posts,
      };
    } catch {
      return notReady(reply);
    }
  });

  app.get<{ Params: { slug: string } }>(
    "/v1/posts/:slug",
    async (request, reply) => {
      const storage =
        options.storage ??
        (() => {
          const config = readObjectStorageConfig();
          return config ? createObjectStorage(config) : null;
        })();
      if (!storage) return notReady(reply);
      try {
        const release = await readPublishedRelease(storage, currentPointerKey);
        const post = findPublishedPost(release.posts, request.params.slug);
        if (!post)
          return reply.code(404).send({ error: { code: "NOT_FOUND" } });
        reply.header("X-Arsvine-Content-Release", release.pointer.releaseId);
        return {
          releaseId: release.pointer.releaseId,
          publishedAt: release.pointer.publishedAt,
          post: {
            ...post,
            ...(post.access?.mode === "totp" ? { variants: undefined } : {}),
          },
        };
      } catch {
        return notReady(reply);
      }
    },
  );

  app.get<{ Params: { slug: string; locale: string } }>(
    "/v1/posts/:slug/variants/:locale",
    async (request, reply) => {
      const storage =
        options.storage ??
        (() => {
          const config = readObjectStorageConfig();
          return config ? createObjectStorage(config) : null;
        })();
      if (!storage) return notReady(reply);
      try {
        const release = await readPublishedRelease(storage, currentPointerKey);
        const post = findPublishedPost(release.posts, request.params.slug);
        if (!post)
          return reply.code(404).send({ error: { code: "NOT_FOUND" } });
        if (post.access?.mode === "totp") {
          return reply.code(403).send({ error: { code: "PROTECTED_CONTENT" } });
        }
        const key = getVariantKey(post, request.params.locale);
        if (!key) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
        const variant = JSON.parse(await storage.getText(key)) as unknown;
        reply.header("X-Arsvine-Content-Release", release.pointer.releaseId);
        return {
          releaseId: release.pointer.releaseId,
          publishedAt: release.pointer.publishedAt,
          variant,
        };
      } catch {
        return notReady(reply);
      }
    },
  );

  app.get("/v1/tweets", async (_request, reply) => {
    const storage =
      options.storage ??
      (() => {
        const config = readObjectStorageConfig();
        return config ? createObjectStorage(config) : null;
      })();
    if (!storage) return notReady(reply);
    try {
      const release = await readPublishedRelease(storage, currentPointerKey);
      reply.header("X-Arsvine-Content-Release", release.pointer.releaseId);
      return {
        releaseId: release.pointer.releaseId,
        publishedAt: release.pointer.publishedAt,
        months: release.tweetIndex,
      };
    } catch {
      return notReady(reply);
    }
  });

  app.get("/v1/tweets/months", async (_request, reply) => {
    const storage =
      options.storage ??
      (() => {
        const config = readObjectStorageConfig();
        return config ? createObjectStorage(config) : null;
      })();
    if (!storage) return notReady(reply);
    try {
      const release = await readPublishedRelease(storage, currentPointerKey);
      reply.header("X-Arsvine-Content-Release", release.pointer.releaseId);
      return {
        releaseId: release.pointer.releaseId,
        publishedAt: release.pointer.publishedAt,
        months: release.tweetIndex,
      };
    } catch {
      return notReady(reply);
    }
  });

  app.get<{ Params: { month: string } }>(
    "/v1/tweets/months/:month",
    async (request, reply) => {
      const storage =
        options.storage ??
        (() => {
          const config = readObjectStorageConfig();
          return config ? createObjectStorage(config) : null;
        })();
      if (!storage) return notReady(reply);
      try {
        const release = await readPublishedRelease(storage, currentPointerKey);
        const month = await readPublishedTweetMonth(storage, release, request.params.month);
        if (!month) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
        reply.header("X-Arsvine-Content-Release", release.pointer.releaseId);
        return {
          releaseId: release.pointer.releaseId,
          publishedAt: release.pointer.publishedAt,
          month: month.entry.month,
          tweets: month.tweets.filter(
            (tweet) => tweet.visibility === undefined || tweet.visibility === "public",
          ),
        };
      } catch {
        return notReady(reply);
      }
    },
  );

  return app;
}
