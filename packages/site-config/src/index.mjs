const defaultOrigins = {
  realm: "https://arsvine.com",
  ripple: "https://ripple.arsvine.com",
  console: "https://console.arsvine.com",
  auth: "https://auth.arsvine.com",
  api: "https://api.arsvine.com",
  content: "https://content.arsvine.com",
  status: "https://status.arsvine.com",
};

function configuredOrigins() {
  const raw =
    typeof process === "undefined" ? undefined : process.env.ARS_WEB_ORIGINS;
  if (!raw) return Object.freeze(defaultOrigins);
  const overrides = JSON.parse(raw);
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("ARS_WEB_ORIGINS must be an object of origins");
  }
  for (const [service, origin] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(defaultOrigins, service) ||
      typeof origin !== "string" ||
      new URL(origin).origin !== origin ||
      !origin.startsWith("https://")
    ) {
      throw new Error("Invalid ARS_WEB_ORIGINS entry");
    }
  }
  return Object.freeze({ ...defaultOrigins, ...overrides });
}

const origins = configuredOrigins();

export function internalServiceUrl(service, publicUrl = origins[service]) {
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env.ARS_WEB_INTERNAL_ORIGINS;
  if (!raw) return publicUrl;
  const origin = JSON.parse(raw)[service];
  if (!origin) return publicUrl;
  const internal = new URL(origin);
  if (
    internal.origin !== origin ||
    internal.protocol !== "http:" ||
    internal.hostname !== "127.0.0.1" ||
    !internal.port
  ) {
    throw new Error("Invalid internal Web service origin");
  }
  const url = new URL(publicUrl);
  return new URL(url.pathname + url.search, internal).toString();
}

/** Stable public origins used by every Arsvine site. */
export const serviceOrigins = origins;

/** Immutable Catalog / Content object-key namespaces on CDN or private storage. */
export const catalogNamespaces = Object.freeze({
  realmAssets: "realm",
  realmContent: "realm-content",
  ripple: "ripple",
});

const authOrigin = origins.auth;
const authPaths = Object.freeze({
  authorization: `${authOrigin}/api/auth/oauth2/authorize`,
  token: `${authOrigin}/api/auth/oauth2/token`,
  userinfo: `${authOrigin}/api/auth/oauth2/userinfo`,
  jwks: `${authOrigin}/jwks`,
  endSession: `${authOrigin}/api/auth/oauth2/end-session`,
});

const consoleOrigin = origins.console;
const contentOrigin = origins.content;

export const siteConfig = Object.freeze({
  realm: Object.freeze({
    origin: origins.realm,
    revalidateUrl: `${origins.realm}/api/internal/revalidate`,
    healthLivePath: "/api/health/live",
    healthReadyPath: "/api/health/ready",
  }),
  ripple: Object.freeze({
    origin: origins.ripple,
    healthLivePath: "/health/live",
    healthReadyPath: "/health/ready",
    musicApiPath: "/api/music",
  }),
  console: Object.freeze({
    origin: consoleOrigin,
    healthLivePath: "/health/live",
    healthReadyPath: "/health/ready",
    oidc: Object.freeze({
      issuer: authOrigin,
      authorizationUrl: authPaths.authorization,
      tokenUrl: authPaths.token,
      userinfoUrl: authPaths.userinfo,
      jwksUrl: authPaths.jwks,
      endSessionUrl: authPaths.endSession,
      redirectUri: `${consoleOrigin}/auth/callback`,
      postLogoutRedirectUri: `${consoleOrigin}/auth/signed-out`,
      resource: origins.api,
      scope:
        "openid profile email content:read content:write content:publish assets:read assets:write integrations:read integrations:write jobs:read jobs:run",
    }),
  }),
  auth: Object.freeze({
    origin: authOrigin,
    displayName: "Arsvine Auth",
    issuer: authOrigin,
    jwksUrl: authPaths.jwks,
    audience: Object.freeze([origins.api, contentOrigin]),
    oauthResources: Object.freeze([origins.api, contentOrigin]),
    passkeyRpId: new URL(authOrigin).hostname,
    passkeyOrigin: authOrigin,
    healthLivePath: "/health/live",
    healthReadyPath: "/health/ready",
  }),
  api: Object.freeze({
    origin: origins.api,
    displayName: "Arsvine Control API",
    resource: origins.api,
    healthLivePath: "/health/live",
    healthReadyPath: "/health/ready",
  }),
  content: Object.freeze({
    origin: contentOrigin,
    displayName: "Arsvine Published Content",
    resource: contentOrigin,
    pointerKey: `${catalogNamespaces.realmContent}/current.json`,
    publicationUrl: `${contentOrigin}/v1/internal/publications`,
    healthLivePath: "/health/live",
    healthReadyPath: "/health/ready",
  }),
  status: Object.freeze({ origin: origins.status }),
});
