import { readEnv } from "@arsvine/env";
import { healthHeaders, readyBody } from "@arsvine/service-health";
import { probeAuthDatabase } from "../../../lib/auth";

export async function GET() {
  const missing = [
    "AUTH_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "AUTH_TRUSTED_ORIGINS",
  ].filter((key) => !readEnv(key));
  let reason = missing.length
    ? `missing_configuration:${missing.join(",")}`
    : null;
  if (!reason) {
    try {
      await probeAuthDatabase();
    } catch {
      reason = "database";
    }
  }
  return Response.json(
    reason
      ? { status: "not_ready", service: "auth", reason }
      : readyBody("auth"),
    {
      status: reason ? 503 : 200,
      headers: healthHeaders,
    },
  );
}
