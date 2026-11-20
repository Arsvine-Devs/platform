import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { getAuth } from "./auth";

export type ConsentRequest = {
  signedQuery: string;
  appName: string | null;
  appDestination: string;
  email: string;
  scopes: string[];
  claims: string[];
};

export type OAuthSearchParams = Record<string, string | string[] | undefined>;

export function signedOAuthQuery(search: OAuthSearchParams): URLSearchParams {
  const parameters = search.ba_param ?? [];
  const names = new Set(["sig", "ba_param", ...[parameters].flat()]);
  const signed = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (!names.has(name) || value === undefined) continue;
    for (const part of [value].flat()) signed.append(name, part);
  }
  return signed;
}

function userInfoClaims(claims: string | null): string[] {
  if (!claims) return [];
  const userinfo: unknown = (JSON.parse(claims) as { userinfo?: unknown })
    .userinfo;
  return userinfo !== null &&
    typeof userinfo === "object" &&
    !Array.isArray(userinfo)
    ? Object.keys(userinfo)
    : [];
}

export async function readConsentRequest(
  search: OAuthSearchParams,
  requestHeaders: Headers,
): Promise<ConsentRequest | null> {
  const params = signedOAuthQuery(search);
  const auth = getAuth();
  const clientId = params.get("client_id");
  const destination = params.get("redirect_uri");
  if (!auth || !clientId || !destination) return null;

  try {
    const signedQuery = params.toString();
    const { secret } = await auth.$context;
    if (!(await verifyOAuthQueryParams(signedQuery, secret))) return null;
    const session = await auth.api.getSession({
      headers: requestHeaders,
      query: { disableRefresh: true },
    });
    if (!session) return null;
    const client = await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: requestHeaders,
    });
    const redirect = new URL(destination);
    return {
      signedQuery,
      appName: client.client_name ?? null,
      appDestination: redirect.host || destination,
      email: session.user.email,
      scopes: [
        ...new Set((params.get("scope") ?? "").split(" ").filter(Boolean)),
      ],
      claims: userInfoClaims(params.get("claims")),
    };
  } catch {
    return null;
  }
}
