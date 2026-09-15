import { readEnv } from "@arsvine/env";

export function GET() {
  const missing = [
    "AUTH_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_ISSUER",
    "BETTER_AUTH_AUDIENCE",
    "AUTH_TRUSTED_ORIGINS",
    "OAUTH_RESOURCES",
    "PASSKEY_RP_ID",
    "PASSKEY_ORIGIN",
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
