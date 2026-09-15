import { readEnv } from "@arsvine/env";

export function GET() {
  const missing = [
    "AUTH_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "AUTH_TRUSTED_ORIGINS",
  ].filter((key) => !readEnv(key));
  const ready = missing.length === 0;
  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      service: "auth",
      ...(ready
        ? {}
        : { reason: `missing_configuration:${missing.join(",")}` }),
    },
    { status: ready ? 200 : 503 },
  );
}
