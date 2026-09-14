import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { Type } from "@sinclair/typebox";
import { log } from "@arsvine/observability";

const errorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.Optional(Type.String()),
  }),
});

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
        response: { 401: errorSchema },
      },
    },
    async (request, reply) => {
      const requestId = request.id;
      log("info", {
        service: "api",
        operation: "me.unauthenticated",
        requestId,
      });
      return reply.code(401).send({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication is required.",
          requestId,
        },
      });
    },
  );

  return app;
}
