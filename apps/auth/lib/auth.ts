import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import {
  admin,
  createAccessControl,
  jwt,
  twoFactor,
} from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

type AuthDatabase = Record<string, never>;

function readList(name: string): string[] | undefined {
  const values = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values?.length ? values : undefined;
}

const databaseUrl = process.env.AUTH_DATABASE_URL?.trim();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const kysely = pool
  ? new Kysely<AuthDatabase>({ dialect: new PostgresDialect({ pool }) })
  : null;
const authBaseUrl = process.env.BETTER_AUTH_URL?.trim();
const authIssuer = process.env.BETTER_AUTH_ISSUER?.trim();
const authDisplayName = process.env.AUTH_DISPLAY_NAME?.trim();
const authAudience = readList("BETTER_AUTH_AUDIENCE");
const trustedOrigins = readList("AUTH_TRUSTED_ORIGINS");
const oauthResources = readList("OAUTH_RESOURCES");
const passkeyRpId = process.env.PASSKEY_RP_ID?.trim();
const passkeyOrigin = process.env.PASSKEY_ORIGIN?.trim();

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

if (!kysely) {
  // The service can still build and expose liveness locally without credentials.
  // Auth requests remain unavailable until AUTH_DATABASE_URL and BETTER_AUTH_SECRET exist.
  console.warn("[auth] AUTH_DATABASE_URL is not configured");
}

if (!authBaseUrl) {
  console.warn(
    "[auth] BETTER_AUTH_URL is not configured; OAuth provider is disabled",
  );
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
    jwt: { issuer: authIssuer, audience: authAudience },
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
  database: kysely
    ? kyselyAdapter(kysely, { type: "postgres", transaction: true })
    : undefined,
  baseURL: authBaseUrl,
  secret: process.env.BETTER_AUTH_SECRET ?? "development-only-auth-secret",
  emailAndPassword: { enabled: true },
  trustedOrigins,
  plugins: authPlugins,
});
