import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { authUnavailable, getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const auth = getAuth();
  return auth
    ? oauthProviderAuthServerMetadata(auth)(request)
    : authUnavailable();
}
