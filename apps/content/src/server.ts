import Fastify from "fastify";
import swagger from "@fastify/swagger";
import {
  readObjectStorageConfig,
  createObjectStorage,
} from "@arsvine/object-storage";
import { log } from "@arsvine/observability";

const currentPointerKey =
  process.env.CONTENT_CURRENT_POINTER ?? "realm-content/current.json";

export function buildContentServer() {
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
    const config = readObjectStorageConfig();
    if (!config)
      return reply.code(503).send({ status: "not_ready", service: "content" });

    try {
      await createObjectStorage(config).getText(currentPointerKey);
      return { status: "ready", service: "content" };
    } catch {
      return reply.code(503).send({ status: "not_ready", service: "content" });
    }
  });

  app.get("/v1/posts", async (_request, reply) => {
    const config = readObjectStorageConfig();
    if (!config) {
      return reply.code(503).send({
        error: {
          code: "NOT_READY",
          message: "Published content storage is not configured.",
        },
      });
    }
    log("info", { service: "content", operation: "posts.read" });
    return reply.code(503).send({
      error: {
        code: "NOT_READY",
        message: "Published release reader is not configured.",
      },
    });
  });

  return app;
}
