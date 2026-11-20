import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readConsentRequest,
  signedOAuthQuery,
  type OAuthSearchParams,
} from "./consent";
import { oauthDestination } from "./oauth-navigation";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOAuthClientPublic: vi.fn(),
  secret: "OAuth test fixture signing key",
}));

vi.mock("./auth", () => ({
  getAuth: () => ({ $context: { secret: mocks.secret }, api: mocks }),
}));

async function authorizeSearch(
  expirationSeconds = Math.floor(Date.now() / 1000) + 60,
) {
  const search: OAuthSearchParams = {
    client_id: "fixture-client",
    redirect_uri: "https://preview-console.example.com/auth/callback",
    response_type: "code",
    scope: "openid content:read",
    claims: JSON.stringify({ userinfo: { email: null } }),
    exp: String(expirationSeconds),
  };
  search.ba_param = [...Object.keys(search), "ba_param"].sort();
  const canonical = signedOAuthQuery(search);
  canonical.sort();
  search.sig = await makeSignature(canonical.toString(), mocks.secret);
  return search;
}

describe("OAuth consent request", () => {
  const requestHeaders = new Headers();

  beforeEach(() => {
    mocks.getSession
      .mockReset()
      .mockResolvedValue({ user: { email: "owner@example.com" } });
    mocks.getOAuthClientPublic
      .mockReset()
      .mockResolvedValue({ client_name: "Preview Console" });
  });

  it("renders the verified destination, permissions and account from the current request", async () => {
    const search = { ...(await authorizeSearch()), unrelated: "ignored" };
    const request = await readConsentRequest(search, requestHeaders);
    expect(request).toMatchObject({
      appName: "Preview Console",
      appDestination: "preview-console.example.com",
      email: "owner@example.com",
      scopes: ["openid", "content:read"],
      claims: ["email"],
    });
    expect(request?.signedQuery).not.toContain("unrelated");
    expect(mocks.getOAuthClientPublic).toHaveBeenCalledWith({
      headers: requestHeaders,
      query: { client_id: "fixture-client" },
    });
  });

  it("rejects changed, expired, and unauthenticated requests", async () => {
    expect(
      await readConsentRequest(
        { ...(await authorizeSearch()), scope: "openid" },
        requestHeaders,
      ),
    ).toBeNull();
    expect(
      await readConsentRequest(await authorizeSearch(1), requestHeaders),
    ).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
    mocks.getSession.mockResolvedValueOnce(null);
    expect(
      await readConsentRequest(await authorizeSearch(), requestHeaders),
    ).toBeNull();
    expect(mocks.getOAuthClientPublic).not.toHaveBeenCalled();
  });

  it("allows only the provider origin and signed callback destination", async () => {
    const signed = signedOAuthQuery(await authorizeSearch()).toString();
    const auth = "https://auth.example.com";
    const callback =
      "https://preview-console.example.com/auth/callback?code=fixture";
    expect(oauthDestination(callback, signed, auth)).toBe(callback);
    expect(oauthDestination("/consent", signed, auth)).toBe(`${auth}/consent`);
    expect(
      oauthDestination(
        "https://console.example.com/auth/callback",
        signed,
        auth,
      ),
    ).toBeNull();
    expect(
      oauthDestination(
        "https://preview-console.example.com/other",
        signed,
        auth,
      ),
    ).toBeNull();
  });
});
