import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hasScopes, type AuthPrincipal } from "@arsvine/authz";
import {
  createPost,
  createTweet,
  deletePost,
  deleteTweet,
  findPost,
  findPostVariant,
  listPosts,
  listTweets,
  updatePost,
  updateTweet,
  upsertPostVariant,
} from "@arsvine/core-db";
import { log } from "@arsvine/observability";

type AuthenticatedRequest = FastifyRequest & { authPrincipal?: AuthPrincipal };

const errorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.Optional(Type.String()),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
});

const postWriteSchema = Type.Object(
  {
    slug: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    sourceLocale: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
    status: Type.Optional(
      Type.Union([
        Type.Literal("draft"),
        Type.Literal("published"),
        Type.Literal("archived"),
      ]),
    ),
    pinned: Type.Optional(Type.Boolean()),
    accessMode: Type.Optional(
      Type.Union([Type.Literal("public"), Type.Literal("totp")]),
    ),
    accessGroup: Type.Optional(Type.String({ maxLength: 160 })),
    tags: Type.Optional(
      Type.Array(Type.String({ maxLength: 80 }), { maxItems: 64 }),
    ),
    variant: Type.Optional(
      Type.Object({
        locale: Type.String({ minLength: 2, maxLength: 16 }),
        title: Type.String({ minLength: 1, maxLength: 300 }),
        excerpt: Type.Optional(Type.String({ maxLength: 2000 })),
        bodyMdx: Type.Optional(Type.String({ maxLength: 2_000_000 })),
        originLocale: Type.Optional(Type.String({ maxLength: 16 })),
        translationState: Type.Optional(Type.String({ maxLength: 32 })),
      }),
    ),
  },
  { additionalProperties: false },
);

const variantWriteSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 300 }),
    excerpt: Type.Optional(Type.String({ maxLength: 2000 })),
    bodyMdx: Type.Optional(Type.String({ maxLength: 2_000_000 })),
    originLocale: Type.Optional(Type.String({ maxLength: 16 })),
    translationState: Type.Optional(Type.String({ maxLength: 32 })),
  },
  { additionalProperties: false },
);

const tweetWriteSchema = Type.Object(
  {
    content: Type.Optional(Type.String({ minLength: 1, maxLength: 10000 })),
    locale: Type.Optional(Type.String({ maxLength: 16 })),
    tags: Type.Optional(
      Type.Array(Type.String({ maxLength: 80 }), { maxItems: 64 }),
    ),
    visibility: Type.Optional(
      Type.Union([
        Type.Literal("public"),
        Type.Literal("private"),
        Type.Literal("hidden"),
      ]),
    ),
    pinned: Type.Optional(Type.Boolean()),
    publishedAt: Type.Optional(Type.String()),
    source: Type.Optional(
      Type.Union([Type.Literal("manual"), Type.Literal("x")]),
    ),
    externalId: Type.Optional(Type.String({ maxLength: 200 })),
    origin: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

function principal(request: FastifyRequest) {
  return (request as AuthenticatedRequest).authPrincipal;
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return reply.code(status).send({
    error: {
      code,
      message,
      requestId: request.id,
      ...(details ? { details } : {}),
    },
  });
}

function requireScope(scope: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const current = principal(request);
    if (!current)
      return sendError(
        reply,
        request,
        401,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    if (!hasScopes(current, [scope])) {
      reply.header(
        "WWW-Authenticate",
        `Bearer error="insufficient_scope", scope="${scope}"`,
      );
      return sendError(
        reply,
        request,
        403,
        "INSUFFICIENT_SCOPE",
        `Scope ${scope} is required.`,
      );
    }
  };
}

function parseRevision(request: FastifyRequest) {
  const header = request.headers["if-match"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const value = raw.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : undefined;
}

function validateString(value: unknown, field: string, fallback?: string) {
  const result = typeof value === "string" ? value.trim() : fallback;
  if (!result) throw new Error(`${field} is required.`);
  return result;
}

function validateSlug(value: unknown) {
  const slug = validateString(value, "slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("slug is invalid.");
  return slug;
}

function handleDomainError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof Error && error.name === "PreconditionRequired") {
    return sendError(
      reply,
      request,
      428,
      "PRECONDITION_REQUIRED",
      error.message,
    );
  }
  if (error instanceof Error && error.name === "RevisionConflict") {
    return sendError(reply, request, 412, "REVISION_CONFLICT", error.message);
  }
  if (error instanceof Error && /required|invalid|empty/i.test(error.message)) {
    return sendError(reply, request, 422, "VALIDATION_FAILED", error.message);
  }
  log("error", {
    service: "api",
    operation: "core.request",
    requestId: request.id,
    message: error instanceof Error ? error.message : "unknown",
  });
  return sendError(
    reply,
    request,
    503,
    "CORE_DATABASE_UNAVAILABLE",
    "The Core database is unavailable.",
  );
}

export function registerContentRoutes(
  app: FastifyInstance,
  authenticateRequest: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<unknown>,
) {
  app.get(
    "/v1/posts",
    {
      schema: {
        response: {
          200: Type.Object({ posts: Type.Array(Type.Unknown()) }),
          401: errorSchema,
          403: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:read")],
    },
    async (request, reply) => {
      try {
        return { posts: await listPosts() };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/posts",
    {
      schema: {
        body: postWriteSchema,
        response: {
          201: Type.Object({ post: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          422: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      try {
        const body = request.body as Record<string, unknown>;
        const actor = principal(request);
        if (!actor)
          return sendError(
            reply,
            request,
            401,
            "AUTH_REQUIRED",
            "Authentication is required.",
          );
        const post = await createPost(
          {
            slug: validateSlug(body.slug),
            sourceLocale: validateString(
              body.sourceLocale,
              "sourceLocale",
              "zh-CN",
            ),
            status: body.status as
              "draft" | "published" | "archived" | undefined,
            pinned: body.pinned as boolean | undefined,
            accessMode: body.accessMode as "public" | "totp" | undefined,
            accessGroup:
              typeof body.accessGroup === "string"
                ? body.accessGroup.trim()
                : undefined,
            tags: Array.isArray(body.tags)
              ? body.tags.filter(
                  (tag): tag is string => typeof tag === "string",
                )
              : [],
            variant: body.variant as never,
          },
          actor.subject,
        );
        if (!post)
          return sendError(
            reply,
            request,
            503,
            "CORE_DATABASE_UNAVAILABLE",
            "The Core database is unavailable.",
          );
        reply.header("ETag", `"${post.revision}"`);
        return reply.code(201).send({ post });
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/posts/:id",
    {
      schema: {
        response: {
          200: Type.Object({ post: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:read")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const post = await findPost(id, true);
        if (!post)
          return sendError(reply, request, 404, "NOT_FOUND", "Post not found.");
        reply.header("ETag", `"${post.revision}"`);
        return { post };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.patch(
    "/v1/posts/:id",
    {
      schema: {
        body: postWriteSchema,
        response: {
          200: Type.Object({ post: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          412: errorSchema,
          422: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const actor = principal(request);
        if (!actor)
          return sendError(
            reply,
            request,
            401,
            "AUTH_REQUIRED",
            "Authentication is required.",
          );
        const body = request.body as Record<string, unknown>;
        const revision = parseRevision(request);
        if (revision === undefined)
          return sendError(
            reply,
            request,
            428,
            "PRECONDITION_REQUIRED",
            "If-Match is required for edits.",
          );
        const post = await updatePost(
          id,
          {
            ...(body.slug === undefined
              ? {}
              : { slug: validateSlug(body.slug) }),
            ...(body.sourceLocale === undefined
              ? {}
              : {
                  sourceLocale: validateString(
                    body.sourceLocale,
                    "sourceLocale",
                  ),
                }),
            ...(body.status === undefined
              ? {}
              : { status: body.status as "draft" | "published" | "archived" }),
            ...(body.pinned === undefined
              ? {}
              : { pinned: Boolean(body.pinned) }),
            ...(body.accessMode === undefined
              ? {}
              : { accessMode: body.accessMode as "public" | "totp" }),
            ...(body.accessGroup === undefined
              ? {}
              : { accessGroup: body.accessGroup as string | null }),
            ...(body.tags === undefined
              ? {}
              : {
                  tags: Array.isArray(body.tags)
                    ? body.tags.filter(
                        (tag): tag is string => typeof tag === "string",
                      )
                    : [],
                }),
          },
          actor.subject,
          revision,
        );
        if (!post)
          return sendError(reply, request, 404, "NOT_FOUND", "Post not found.");
        reply.header("ETag", `"${post.revision}"`);
        return { post };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.delete(
    "/v1/posts/:id",
    {
      schema: {
        response: {
          200: Type.Object({ deleted: Type.String() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          412: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const revision = parseRevision(request);
        if (revision === undefined)
          return sendError(
            reply,
            request,
            428,
            "PRECONDITION_REQUIRED",
            "If-Match is required for deletion.",
          );
        const result = await deletePost(id, revision);
        if (!result)
          return sendError(reply, request, 404, "NOT_FOUND", "Post not found.");
        return { deleted: result.id };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/posts/:id/variants/:locale",
    {
      schema: {
        response: {
          200: Type.Object({ post: Type.Unknown(), variant: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:read")],
    },
    async (request, reply) => {
      const { id, locale } = request.params as { id: string; locale: string };
      try {
        const result = await findPostVariant(id, locale);
        if (!result)
          return sendError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Post variant not found.",
          );
        reply.header("ETag", `"${result.variant.revision}"`);
        return result;
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.put(
    "/v1/posts/:id/variants/:locale",
    {
      schema: {
        body: variantWriteSchema,
        response: {
          200: Type.Object({ post: Type.Unknown(), variant: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          412: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      const { id, locale } = request.params as { id: string; locale: string };
      try {
        const actor = principal(request);
        if (!actor)
          return sendError(
            reply,
            request,
            401,
            "AUTH_REQUIRED",
            "Authentication is required.",
          );
        const body = request.body as Record<string, unknown>;
        const revision = parseRevision(request);
        const result = await upsertPostVariant(
          id,
          locale,
          {
            title: validateString(body.title, "title"),
            excerpt: typeof body.excerpt === "string" ? body.excerpt : "",
            bodyMdx: typeof body.bodyMdx === "string" ? body.bodyMdx : "",
            originLocale:
              typeof body.originLocale === "string"
                ? body.originLocale
                : undefined,
            translationState:
              typeof body.translationState === "string"
                ? body.translationState
                : undefined,
          },
          actor.subject,
          revision,
        );
        if (!result)
          return sendError(reply, request, 404, "NOT_FOUND", "Post not found.");
        reply.header("ETag", `"${result.variant.revision}"`);
        return result;
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/tweets",
    {
      schema: {
        response: {
          200: Type.Object({ tweets: Type.Array(Type.Unknown()) }),
          401: errorSchema,
          403: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:read")],
    },
    async (request, reply) => {
      try {
        return { tweets: await listTweets() };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/tweets",
    {
      schema: {
        body: tweetWriteSchema,
        response: {
          201: Type.Object({ tweet: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          422: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      try {
        const actor = principal(request);
        if (!actor)
          return sendError(
            reply,
            request,
            401,
            "AUTH_REQUIRED",
            "Authentication is required.",
          );
        const body = request.body as Record<string, unknown>;
        const content = validateString(body.content, "content");
        const tweet = await createTweet(
          {
            content,
            locale: typeof body.locale === "string" ? body.locale : undefined,
            tags: Array.isArray(body.tags)
              ? body.tags.filter(
                  (tag): tag is string => typeof tag === "string",
                )
              : [],
            visibility: body.visibility as
              "public" | "private" | "hidden" | undefined,
            pinned: body.pinned as boolean | undefined,
            publishedAt:
              typeof body.publishedAt === "string"
                ? body.publishedAt
                : undefined,
            source: body.source as "manual" | "x" | undefined,
            externalId:
              typeof body.externalId === "string" ? body.externalId : undefined,
            origin:
              typeof body.origin === "object" && body.origin !== null
                ? (body.origin as Record<string, unknown>)
                : undefined,
          },
          actor.subject,
        );
        if (!tweet)
          return sendError(
            reply,
            request,
            503,
            "CORE_DATABASE_UNAVAILABLE",
            "The Core database is unavailable.",
          );
        reply.header("ETag", `"${tweet.revision}"`);
        return reply.code(201).send({ tweet });
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/tweets/:id",
    {
      schema: {
        response: {
          200: Type.Object({ tweet: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:read")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const tweet = (await listTweets()).find((item) => item.id === id);
        if (!tweet)
          return sendError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Tweet not found.",
          );
        reply.header("ETag", `"${tweet.revision}"`);
        return { tweet };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.patch(
    "/v1/tweets/:id",
    {
      schema: {
        body: tweetWriteSchema,
        response: {
          200: Type.Object({ tweet: Type.Unknown() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          412: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const actor = principal(request);
        if (!actor)
          return sendError(
            reply,
            request,
            401,
            "AUTH_REQUIRED",
            "Authentication is required.",
          );
        const body = request.body as Record<string, unknown>;
        const revision = parseRevision(request);
        if (revision === undefined)
          return sendError(
            reply,
            request,
            428,
            "PRECONDITION_REQUIRED",
            "If-Match is required for edits.",
          );
        const tweet = await updateTweet(
          id,
          {
            content:
              typeof body.content === "string" ? body.content : undefined,
            locale: typeof body.locale === "string" ? body.locale : undefined,
            tags: Array.isArray(body.tags)
              ? body.tags.filter(
                  (tag): tag is string => typeof tag === "string",
                )
              : undefined,
            visibility: body.visibility as
              "public" | "private" | "hidden" | undefined,
            pinned: body.pinned as boolean | undefined,
            publishedAt:
              typeof body.publishedAt === "string"
                ? body.publishedAt
                : undefined,
          },
          actor.subject,
          revision,
        );
        if (!tweet)
          return sendError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Tweet not found.",
          );
        reply.header("ETag", `"${tweet.revision}"`);
        return { tweet };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );

  app.delete(
    "/v1/tweets/:id",
    {
      schema: {
        response: {
          200: Type.Object({ deleted: Type.String() }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          412: errorSchema,
        },
      },
      preHandler: [authenticateRequest, requireScope("content:write")],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const revision = parseRevision(request);
        if (revision === undefined)
          return sendError(
            reply,
            request,
            428,
            "PRECONDITION_REQUIRED",
            "If-Match is required for deletion.",
          );
        const result = await deleteTweet(id, revision);
        if (!result)
          return sendError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Tweet not found.",
          );
        return { deleted: result.id };
      } catch (error) {
        return handleDomainError(error, request, reply);
      }
    },
  );
}
