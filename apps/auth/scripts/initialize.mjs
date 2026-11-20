import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { siteConfig } from "@arsvine/site-config";
import { getAuth } from "../lib/auth.ts";

const [, , email, outputFile] = process.argv;
if (!email || !email.includes("@") || !outputFile) {
  throw new Error(
    "Usage: node --env-file=<auth.env> scripts/initialize.mjs <owner-email> <private-output-file>",
  );
}

const path = resolve(outputFile);
const auth = getAuth();
if (!auth)
  throw new Error(
    "Auth database, signing secret, and trusted origins are required",
  );

async function store(data) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

const migration = await getMigrations(auth.options);
await migration.runMigrations();
const context = await auth.$context;
const normalizedEmail = email.toLowerCase();
let state;
try {
  state = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  if ((await context.adapter.count({ model: "user" })) !== 0) {
    throw new Error(
      "An initialized Auth database requires its original bootstrap file",
    );
  }
  state = {
    issuer: siteConfig.auth.issuer,
    email: normalizedEmail,
    password: randomBytes(32).toString("base64url"),
    clients: {},
  };
  await store(state);
}
if (
  state.issuer !== siteConfig.auth.issuer ||
  state.email !== normalizedEmail
) {
  throw new Error(
    "The bootstrap file belongs to a different environment or owner",
  );
}

const existing = await context.internalAdapter.findUserByEmail(normalizedEmail);
if (!existing) {
  const user = await context.internalAdapter.createUser({
    email: normalizedEmail,
    name: "Arsvine",
    emailVerified: true,
    role: "owner",
  });
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(state.password),
  });
}

const headers = new Headers({ origin: siteConfig.auth.origin });
const login = await auth.api.signInEmail({
  body: { email: normalizedEmail, password: state.password },
  headers,
  asResponse: true,
});
if (!login.ok) throw new Error("The Auth owner could not sign in");
headers.set(
  "cookie",
  login.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; "),
);

const { oidc } = siteConfig.console;
const clients = {
  console: {
    client_name: "Arsvine Console",
    redirect_uris: [oidc.redirectUri],
    post_logout_redirect_uris: [oidc.postLogoutRedirectUri],
    resources: [oidc.resource],
    grant_types: ["authorization_code"],
    token_endpoint_auth_method: "client_secret_basic",
    scope: oidc.scope,
    skip_consent: true,
    enable_end_session: true,
    require_pkce: true,
  },
  realm: {
    client_name: "Arsvine Realm",
    resources: [siteConfig.content.resource],
    grant_types: ["client_credentials"],
    token_endpoint_auth_method: "client_secret_basic",
    scope: "content:protected:read",
    client_credentials_scopes: ["content:protected:read"],
  },
};

for (const [name, body] of Object.entries(clients)) {
  if (state.clients[name]) continue;
  const client = await auth.api.adminCreateOAuthClient({ headers, body });
  state.clients[name] = { id: client.client_id, secret: client.client_secret };
  await store(state);
}

console.log("Auth owner and service clients are ready");
process.exit(0);
