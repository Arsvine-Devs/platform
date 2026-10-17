import { readEnv } from "@arsvine/env";
import { healthHeaders, readyBody } from "@arsvine/service-health";

export function GET() {
  const missing = [
    "AUTH_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "AUTH_TRUSTED_ORIGINS",
  ].filter((key) => !readEnv(key));
  const ready = missing.length === 0;
  return Response.json(
    ready
      ? readyBody("auth")
      : {
          status: "not_ready",
          service: "auth",
          reason: `missing_configuration:${missing.join(",")}`,
        },
    { status: ready ? 200 : 503, headers: healthHeaders },
  );
}
