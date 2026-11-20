import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import { Type } from "@sinclair/typebox";
import type { MeResponse } from "@arsvine/contracts";
import { readEnv } from "@arsvine/env";
import { internalServiceUrl, siteConfig } from "@arsvine/site-config";
import {
  AuthTokenError,
  parseBearerToken,
  verifyAccessToken,
  type AuthPrincipal,
} from "@arsvine/authz";
import { log } from "@arsvine/observability";
import { liveBody, readyBody } from "@arsvine/service-health";
import { probeCoreDatabase } from "@arsvine/core-db";
import { registerContentRoutes } from "./content-routes.js";

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
    request.authPrincipal = await verifyAccessToken(token, {
      issuer: siteConfig.auth.issuer,
      audience: siteConfig.api.resource,
      jwksUrl: internalServiceUrl("auth", siteConfig.auth.jwksUrl),
    });
  } catch (error) {
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
  const displayName = siteConfig.api.displayName;
  const publicUrl = siteConfig.api.origin;

  app.register(swagger, {
    openapi: {
      info: { title: displayName, version: "0.1.0" },
      ...(publicUrl ? { servers: [{ url: publicUrl }] } : {}),
    },
  });

  app.get("/openapi.json", async () => app.swagger());

  app.get("/health/live", async () => liveBody("api"));
  app.get("/health/ready", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const missing = ["CORE_DATABASE_URL"].filter((key) => !readEnv(key));
    if (missing.length > 0) {
      return reply.code(503).send({
        status: "not_ready",
        service: "api",
        reason: `missing_configuration:${missing.join(",")}`,
      });
    }
    try {
      await probeCoreDatabase();
      return readyBody("api");
    } catch {
      return reply
        .code(503)
        .send({ status: "not_ready", service: "api", reason: "database" });
    }
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
      const response: MeResponse = {
        id: principal.subject,
        role: principal.role ?? null,
        scopes: [...principal.scopes],
      };
      return response;
    },
  );

  app.register(async (api) => {
    registerContentRoutes(api, authenticateRequest);
  });

  return app;
}
