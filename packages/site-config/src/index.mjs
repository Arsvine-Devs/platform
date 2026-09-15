const origins = Object.freeze({
  realm: "https://arsvine.com",
  console: "https://console.arsvine.com",
  auth: "https://auth.arsvine.com",
  api: "https://api.arsvine.com",
  content: "https://content.arsvine.com",
  cdn: "https://cdn.arsvine.com",
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
  }),
  console: Object.freeze({
    origin: consoleOrigin,
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
  }),
  api: Object.freeze({
    origin: origins.api,
    displayName: "Arsvine Control API",
    resource: origins.api,
  }),
  content: Object.freeze({
    origin: contentOrigin,
    displayName: "Arsvine Published Content",
    resource: contentOrigin,
    pointerKey: "realm-content/current.json",
    publicationUrl: `${contentOrigin}/v1/internal/publications`,
  }),
  cdn: Object.freeze({ origin: origins.cdn }),
});
