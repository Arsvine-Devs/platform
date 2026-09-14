import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import { Type } from "@sinclair/typebox";
import {
  AuthConfigurationError,
  AuthTokenError,
  parseBearerToken,
  verifyAccessToken,
  type AuthPrincipal,
} from "@arsvine/authz";
import { log } from "@arsvine/observability";

declare module "fastify" {
  interface FastifyRequest {
    authPrincipal?: AuthPrincipal;
  }
}

const errorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.Optional(Type.String()),
  }),
});
const meSchema = Type.Object({
  id: Type.String(),
  role: Type.Union([
    Type.Literal("owner"),
    Type.Literal("editor"),
    Type.Null(),
  ]),
  scopes: Type.Array(Type.String()),
});

function sendAuthError(
  reply: FastifyReply,
  requestId: string,
  status: 401 | 503,
  code: string,
  message: string,
) {
  if (status === 401) reply.header("WWW-Authenticate", 'Bearer realm="api"');
  return reply.code(status).send({
    error: { code, message, requestId },
  });
}

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const requestId = request.id;
  try {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      return sendAuthError(
        reply,
        requestId,
        401,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    }
    request.authPrincipal = await verifyAccessToken(token);
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      log("error", { service: "api", operation: "auth.config", requestId });
      return sendAuthError(
        reply,
        requestId,
        503,
        "AUTH_UNAVAILABLE",
        "Authentication verification is not configured.",
      );
    }
    log("info", { service: "api", operation: "auth.rejected", requestId });
    return sendAuthError(
      reply,
      requestId,
      401,
      "AUTH_INVALID",
      error instanceof AuthTokenError
        ? "The access token is invalid."
        : "Authentication is required.",
    );
  }
}

export function buildApiServer() {
  const app = Fastify({ logger: false });
  const displayName = process.env.API_DISPLAY_NAME?.trim() || "Control API";
  const publicUrl = process.env.API_PUBLIC_URL?.trim();

  app.register(swagger, {
    openapi: {
      info: { title: displayName, version: "0.1.0" },
      ...(publicUrl ? { servers: [{ url: publicUrl }] } : {}),
    },
  });

  app.get("/health/live", async () => ({ status: "live", service: "api" }));
  app.get("/health/ready", async (_request, reply) => {
    const ready = Boolean(
      process.env.CORE_DATABASE_URL || process.env.DATABASE_URL,
    );
    if (!ready) {
      return reply.code(503).send({ status: "not_ready", service: "api" });
    }
    return { status: "ready", service: "api" };
  });

  app.get(
    "/v1/me",
    {
      schema: {
        response: { 200: meSchema, 401: errorSchema, 503: errorSchema },
      },
      preHandler: authenticateRequest,
    },
    async (request, reply) => {
      const requestId = request.id;
      const principal = request.authPrincipal;
      if (!principal) {
        return sendAuthError(
          reply,
          requestId,
          401,
          "AUTH_REQUIRED",
          "Authentication is required.",
        );
      }
      log("info", { service: "api", operation: "me.read", requestId });
      return {
        id: principal.subject,
        role: principal.role ?? null,
        scopes: [...principal.scopes],
      };
    },
  );

  return app;
}
