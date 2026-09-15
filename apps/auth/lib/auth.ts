import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { betterAuth } from "better-auth";
import {
  admin,
  createAccessControl,
  jwt,
  twoFactor,
} from "better-auth/plugins";
import { Pool } from "pg";
import { readEnv, readEnvList } from "@arsvine/env";
import { siteConfig } from "@arsvine/site-config";

const databaseUrl = readEnv("AUTH_DATABASE_URL");
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const authBaseUrl = siteConfig.auth.origin;
const authIssuer = siteConfig.auth.issuer;
const authDisplayName = siteConfig.auth.displayName;
const authAudience = [...siteConfig.auth.audience];
const trustedOrigins = readEnvList("AUTH_TRUSTED_ORIGINS");
const oauthResources = [...siteConfig.auth.oauthResources];
const passkeyRpId = siteConfig.auth.passkeyRpId;
const passkeyOrigin = siteConfig.auth.passkeyOrigin;

const statement = {
  content: ["read", "write", "publish"],
  assets: ["read", "write"],
  integrations: ["read", "write"],
  jobs: ["read", "run"],
} as const;
const accessControl = createAccessControl(statement);
const ownerRole = accessControl.newRole({
  content: ["read", "write", "publish"],
  assets: ["read", "write"],
  integrations: ["read", "write"],
  jobs: ["read", "run"],
});
const editorRole = accessControl.newRole({
  content: ["read", "write"],
  assets: ["read"],
  integrations: ["read"],
  jobs: ["read"],
});

if (!pool) {
  // The service can still build and expose liveness locally without credentials.
  // Auth requests remain unavailable until AUTH_DATABASE_URL and BETTER_AUTH_SECRET exist.
  console.warn("[auth] AUTH_DATABASE_URL is not configured");
}

const authPlugins = [
  admin({
    defaultRole: "editor",
    adminRoles: ["owner"],
    ac: accessControl,
    roles: { owner: ownerRole, editor: editorRole },
  }),
  twoFactor({
    issuer: authDisplayName,
    allowPasswordless: true,
    accountLockout: {
      enabled: true,
      maxFailedAttempts: 5,
      durationSeconds: 900,
    },
  }),
  jwt({
    disableSettingJwtHeader: true,
    jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
    jwt: {
      issuer: authIssuer,
      audience: authAudience,
      definePayload: ({ user }) => ({ role: user.role }),
    },
  }),
  passkey({
    rpID: passkeyRpId,
    rpName: authDisplayName,
    origin: passkeyOrigin,
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      residentKey: "required",
      userVerification: "required",
    },
  }),
  ...(authBaseUrl
    ? [
        oauthProvider({
          loginPage: "/sign-in",
          consentPage: "/consent",
          customUserInfoClaims: ({ user }) => ({ role: user.role }),
          scopes: [
            "openid",
            "profile",
            "email",
            "content:read",
            "content:write",
            "content:publish",
            "assets:read",
            "assets:write",
            "integrations:read",
            "integrations:write",
            "jobs:read",
            "jobs:run",
            "content:protected:read",
          ],
          resources: oauthResources,
          enforcePerClientResources: true,
          allowDynamicClientRegistration: false,
          clientRegistrationRequirePKCE: true,
        }),
      ]
    : []),
];

export const auth = betterAuth({
  database: pool ?? undefined,
  baseURL: authBaseUrl,
  secret: readEnv("BETTER_AUTH_SECRET") ?? "development-only-auth-secret",
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    password: {
      hash: (password) => hashPassword(password),
      verify: verifyPassword,
    },
  },
  trustedOrigins,
  plugins: authPlugins,
});
