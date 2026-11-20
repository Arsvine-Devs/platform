import Fastify, { type FastifyReply } from "fastify";
import swagger from "@fastify/swagger";
import { internalServiceUrl, siteConfig } from "@arsvine/site-config";
import {
  AuthTokenError,
  hasScopes,
  parseBearerToken,
  verifyAccessToken,
} from "@arsvine/authz";
import { log } from "@arsvine/observability";
import { liveBody, readyBody } from "@arsvine/service-health";
import { publishedContent } from "./content.js";

const PROTECTED_SCOPE = "content:protected:read";
const PROTECTED_CHALLENGE =
  'Bearer realm="content", scope="content:protected:read"';

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: "NOT_FOUND" } });
}

async function authenticateProtectedContent(
  request: { headers: { authorization?: string } },
  reply: FastifyReply,
) {
  try {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      return reply
        .header("WWW-Authenticate", PROTECTED_CHALLENGE)
        .code(401)
        .send({ error: { code: "AUTH_REQUIRED" } });
    }
    const principal = await verifyAccessToken(token, {
      issuer: siteConfig.auth.issuer,
      audience: siteConfig.content.resource,
      jwksUrl: internalServiceUrl("auth", siteConfig.auth.jwksUrl),
    });
    if (!hasScopes(principal, [PROTECTED_SCOPE])) {
      return reply
        .header(
          "WWW-Authenticate",
          `Bearer error="insufficient_scope", scope="${PROTECTED_SCOPE}"`,
        )
        .code(403)
        .send({ error: { code: "INSUFFICIENT_SCOPE" } });
    }
  } catch (error) {
    return reply
      .header("WWW-Authenticate", PROTECTED_CHALLENGE)
      .code(401)
      .send({
        error: {
          code:
            error instanceof AuthTokenError ? "AUTH_INVALID" : "AUTH_REQUIRED",
        },
      });
  }
}

export function buildContentServer(content = publishedContent) {
  const app = Fastify({ logger: false });
  const { displayName, origin } = siteConfig.content;

  app.register(swagger, {
    openapi: {
      info: { title: displayName, version: "0.1.0" },
      ...(origin ? { servers: [{ url: origin }] } : {}),
    },
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((_error, request, reply) => {
    log("error", {
      service: "content",
      operation: "database.read",
      requestId: request.id,
    });
    return reply.code(503).send({
      error: {
        code: "NOT_READY",
        message: "Published content is not available.",
      },
    });
  });

  app.get("/health/live", async () => liveBody("content"));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await content.ready();
      return readyBody("content");
    } catch {
      return reply.code(503).send({ status: "not_ready", service: "content" });
    }
  });

  app.get("/v1/posts", async () => ({ posts: await content.posts() }));
  app.get<{ Params: { slug: string } }>(
    "/v1/posts/:slug",
    async ({ params }, reply) => {
      const post = await content.post(params.slug);
      return post ? { post } : notFound(reply);
    },
  );

  type VariantParams = { slug: string; locale: string };
  app.get<{ Params: VariantParams }>(
    "/v1/posts/:slug/variants/:locale",
    async ({ params }, reply) => {
      const variant = await content.variant(
        params.slug,
        params.locale,
        "public",
      );
      if (variant) return { variant };
      const post = await content.post(params.slug);
      if (post?.access.mode === "totp") {
        return reply.code(403).send({ error: { code: "PROTECTED_CONTENT" } });
      }
      return notFound(reply);
    },
  );
  app.get<{ Params: VariantParams }>(
    "/v1/internal/posts/:slug/variants/:locale",
    { preHandler: authenticateProtectedContent },
    async ({ params }, reply) => {
      const variant = await content.variant(params.slug, params.locale, "totp");
      return variant ? { variant } : notFound(reply);
    },
  );

  app.get("/v1/tweets/months", async () => ({
    months: await content.tweetMonths(),
  }));
  app.get<{ Params: { month: string } }>(
    "/v1/tweets/months/:month",
    async ({ params }, reply) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) return notFound(reply);
      const tweets = await content.tweets(params.month);
      return tweets.length ? { month: params.month, tweets } : notFound(reply);
    },
  );

  return app;
}
