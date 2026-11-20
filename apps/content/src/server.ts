import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import swagger from "@fastify/swagger";
import { readEnv } from "@arsvine/env";
import { internalServiceUrl, siteConfig } from "@arsvine/site-config";
import {
  AuthTokenError,
  hasScopes,
  parseBearerToken,
  verifyAccessToken,
  type AuthVerificationConfig,
} from "@arsvine/authz";
import {
  readObjectStorageConfig,
  createObjectStorage,
} from "@arsvine/object-storage";
import { log } from "@arsvine/observability";
import { liveBody, readyBody } from "@arsvine/service-health";
import {
  findPublishedPost,
  getVariantKey,
  readPublishedTweetMonth,
  readPublishedRelease,
  type ContentStorage,
  type ReleasePost,
} from "./release.js";

const currentPointerKey = siteConfig.content.pointerKey;

type ContentServerOptions = {
  storage?: ContentStorage | null;
};

type PublicationObject = { key: string; body: string };

function verifyPublicationToken(value: string | undefined) {
  const configured = readEnv("CONTENT_PUBLISH_TOKEN");
  if (!configured || !value) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function writableStorage() {
  const config = readObjectStorageConfig();
  return config ? createObjectStorage(config) : null;
}

function readableStorage(options: ContentServerOptions) {
  return (
    options.storage ??
    (() => {
      const config = readObjectStorageConfig();
      return config ? createObjectStorage(config) : null;
    })()
  );
}

function sanitizePublicPost(post: ReleasePost) {
  if (post.access?.mode !== "totp") return post;
  const sanitized = { ...post };
  delete sanitized.title;
  delete sanitized.excerpt;
  delete sanitized.variants;
  sanitized.tags = [];
  return sanitized;
}

function notReady(reply: FastifyReply) {
  return reply.code(503).send({
    error: {
      code: "NOT_READY",
      message: "Published content storage is not ready.",
    },
  });
}

function readProtectedContentAuthConfig(): AuthVerificationConfig {
  return {
    issuer: siteConfig.auth.issuer,
    audience: siteConfig.content.resource,
    jwksUrl: internalServiceUrl("auth", siteConfig.auth.jwksUrl),
  };
}

async function authenticateProtectedContent(
  request: { headers: { authorization?: string } },
  reply: FastifyReply,
) {
  try {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      reply.header(
        "WWW-Authenticate",
        'Bearer realm="content", scope="content:protected:read"',
      );
      return reply.code(401).send({ error: { code: "AUTH_REQUIRED" } });
    }
    const principal = await verifyAccessToken(
      token,
      readProtectedContentAuthConfig(),
    );
    if (!hasScopes(principal, ["content:protected:read"])) {
      reply.header(
        "WWW-Authenticate",
        'Bearer error="insufficient_scope", scope="content:protected:read"',
      );
      return reply.code(403).send({ error: { code: "INSUFFICIENT_SCOPE" } });
    }
    return principal;
  } catch (error) {
    reply.header(
      "WWW-Authenticate",
      'Bearer realm="content", scope="content:protected:read"',
    );
    return reply.code(401).send({
      error: {
        code:
          error instanceof AuthTokenError ? "AUTH_INVALID" : "AUTH_REQUIRED",
      },
    });
  }
}

export function buildContentServer(options: ContentServerOptions = {}) {
  const app = Fastify({ logger: false });
  const displayName = siteConfig.content.displayName;
  const publicUrl = siteConfig.content.origin;

  app.register(swagger, {
    openapi: {
      info: { title: displayName, version: "0.1.0" },
      ...(publicUrl ? { servers: [{ url: publicUrl }] } : {}),
    },
  });

  app.get("/health/live", async () => liveBody("content"));
  app.get("/health/ready", async (_request, reply) => {
    const storage = readableStorage(options);
    if (!storage)
      return reply.code(503).send({ status: "not_ready", service: "content" });

    try {
      await readPublishedRelease(storage, currentPointerKey);
      return readyBody("content");
    } catch {
      return reply.code(503).send({ status: "not_ready", service: "content" });
    }
  });

  app.post<{
    Body: {
      releaseId: string;
      publishedAt: string;
      pointerKey: string;
      manifestKey: string;
      objects: PublicationObject[];
    };
  }>("/v1/internal/publications", async (request, reply) => {
    const publicationToken = request.headers["x-publication-token"];
    if (
      !verifyPublicationToken(
        Array.isArray(publicationToken)
          ? publicationToken[0]
          : publicationToken,
      )
    ) {
      return reply
        .code(401)
        .send({ error: { code: "PUBLICATION_AUTH_REQUIRED" } });
    }
    const body = request.body;
    if (
      !body ||
      typeof body.releaseId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.releaseId) ||
      typeof body.publishedAt !== "string" ||
      body.pointerKey !== currentPointerKey ||
      body.manifestKey !==
        `realm-content/releases/${body.releaseId}/manifest.json` ||
      !Array.isArray(body.objects) ||
      body.objects.some(
        (object) =>
          !object ||
          typeof object.key !== "string" ||
          typeof object.body !== "string",
      )
    ) {
      return reply.code(422).send({ error: { code: "PUBLICATION_INVALID" } });
    }
    const storage = writableStorage();
    if (!storage) return notReady(reply);
    try {
      for (const object of body.objects) {
        if (
          !object.key.startsWith(`realm-content/releases/${body.releaseId}/`)
        ) {
          return reply
            .code(422)
            .send({ error: { code: "PUBLICATION_INVALID" } });
        }
        await storage.putText(object.key, object.body);
        if ((await storage.getText(object.key)) !== object.body) {
          throw new Error(`Publication verification failed: ${object.key}`);
        }
      }
      const pointer = {
        schemaVersion: 1,
        releaseId: body.releaseId,
        publishedAt: body.publishedAt,
        manifest: body.manifestKey,
      };
      const pointerBody = JSON.stringify(pointer);
      await readPublishedRelease(
        {
          getText: async (key) =>
            key === currentPointerKey ? pointerBody : storage.getText(key),
        },
        currentPointerKey,
      );
      await storage.putText(currentPointerKey, pointerBody, { replace: true });
      return {
        releaseId: body.releaseId,
        pointerKey: body.pointerKey,
        objectCount: body.objects.length,
      };
    } catch {
      log("error", {
        service: "content",
        operation: "publication.failed",
        requestId: request.id,
      });
      return notReady(reply);
    }
  });

  app.get("/v1/posts", async (_request, reply) => {
    const storage = readableStorage(options);
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
        posts: release.posts.map(sanitizePublicPost),
      };
    } catch {
      return notReady(reply);
    }
  });

  app.get<{ Params: { slug: string } }>(
    "/v1/posts/:slug",
    async (request, reply) => {
      const storage = readableStorage(options);
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
          post: sanitizePublicPost(post),
        };
      } catch {
        return notReady(reply);
      }
    },
  );

  app.get<{ Params: { slug: string; locale: string } }>(
    "/v1/posts/:slug/variants/:locale",
    async (request, reply) => {
      const storage = readableStorage(options);
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

  app.get<{ Params: { slug: string; locale: string } }>(
    "/v1/internal/posts/:slug/variants/:locale",
    async (request, reply) => {
      const auth = await authenticateProtectedContent(request, reply);
      if (!auth || "code" in auth) return auth;

      const storage = readableStorage(options);
      if (!storage) return notReady(reply);
      try {
        const release = await readPublishedRelease(storage, currentPointerKey);
        const post = findPublishedPost(release.posts, request.params.slug);
        if (!post || post.access?.mode !== "totp") {
          return reply.code(404).send({ error: { code: "NOT_FOUND" } });
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
    const storage = readableStorage(options);
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
    const storage = readableStorage(options);
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
      const storage = readableStorage(options);
      if (!storage) return notReady(reply);
      try {
        const release = await readPublishedRelease(storage, currentPointerKey);
        const month = await readPublishedTweetMonth(
          storage,
          release,
          request.params.month,
        );
        if (!month)
          return reply.code(404).send({ error: { code: "NOT_FOUND" } });
        reply.header("X-Arsvine-Content-Release", release.pointer.releaseId);
        return {
          releaseId: release.pointer.releaseId,
          publishedAt: release.pointer.publishedAt,
          month: month.entry.month,
          tweets: month.tweets.filter(
            (tweet) =>
              tweet.visibility === undefined || tweet.visibility === "public",
          ),
        };
      } catch {
        return notReady(reply);
      }
    },
  );

  return app;
}
