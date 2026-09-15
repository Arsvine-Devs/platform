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
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

function readList(name: string): string[] | undefined {
  const values = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values?.length ? values : undefined;
}

const databaseUrl = process.env.AUTH_DATABASE_URL?.trim();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const authBaseUrl = process.env.BETTER_AUTH_URL?.trim();
const authIssuer = process.env.BETTER_AUTH_ISSUER?.trim();
const authDisplayName = process.env.AUTH_DISPLAY_NAME?.trim();
const authAudience = readList("BETTER_AUTH_AUDIENCE");
const trustedOrigins = readList("AUTH_TRUSTED_ORIGINS");
const oauthResources = readList("OAUTH_RESOURCES");
const passkeyRpId = process.env.PASSKEY_RP_ID?.trim();
const passkeyOrigin = process.env.PASSKEY_ORIGIN?.trim();

function verifyLegacyPassword(password: string, encoded: string) {
  const match = /^scrypt\\$([^$]+)\\$([^$]+)$/.exec(encoded);
  if (!match) return false;
  const actual = Buffer.from(
    scryptSync(password, match[1], 64).toString("base64url"),
  );
  const expected = Buffer.from(match[2]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function verifyAuthPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}) {
  if (hash.startsWith("scrypt$")) return verifyLegacyPassword(password, hash);
  return verifyPassword({ hash, password });
}

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
  secret: process.env.BETTER_AUTH_SECRET ?? "development-only-auth-secret",
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    password: {
      hash: (password) => hashPassword(password),
      verify: verifyAuthPassword,
    },
  },
  trustedOrigins,
  plugins: authPlugins,
});
