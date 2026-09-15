import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const remoteJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type ProjectRole = "owner" | "editor";

export type AuthVerificationConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
};

export type AuthPrincipal = {
  subject: string;
  role?: ProjectRole;
  scopes: readonly string[];
  claims: JWTPayload;
};

export class AuthTokenError extends Error {
  constructor(
    message: string,
    readonly code = "AUTH_INVALID_TOKEN",
  ) {
    super(message);
    this.name = "AuthTokenError";
  }
}

function getRemoteKeys(jwksUrl: string) {
  let keys = remoteJwks.get(jwksUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(jwksUrl));
    remoteJwks.set(jwksUrl, keys);
  }
  return keys;
}

function readScopes(payload: JWTPayload) {
  if (typeof payload.scope === "string") {
    return payload.scope.split(/\s+/).filter(Boolean);
  }
  if (Array.isArray(payload.scopes)) {
    return payload.scopes.filter(
      (scope): scope is string => typeof scope === "string",
    );
  }
  return [];
}

function readRole(payload: JWTPayload): ProjectRole | undefined {
  return payload.role === "owner" || payload.role === "editor"
    ? payload.role
    : undefined;
}

export function parseBearerToken(value: string | undefined) {
  if (!value) return null;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    throw new AuthTokenError("Malformed Bearer authorization header");
  }
  return parts[1];
}

export async function verifyAccessToken(
  token: string,
  config: AuthVerificationConfig,
): Promise<AuthPrincipal> {
  try {
    const { payload } = await jwtVerify(token, getRemoteKeys(config.jwksUrl), {
      issuer: config.issuer,
      audience: config.audience,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AuthTokenError("Access token subject is missing");
    }
    return {
      subject: payload.sub,
      role: readRole(payload),
      scopes: readScopes(payload),
      claims: payload,
    };
  } catch (error) {
    if (error instanceof AuthTokenError) throw error;
    throw new AuthTokenError("Access token verification failed");
  }
}

export function hasScopes(
  principal: AuthPrincipal,
  required: readonly string[],
) {
  const granted = new Set(principal.scopes);
  return required.every((scope) => granted.has(scope));
}

export function hasRole(principal: AuthPrincipal, required: ProjectRole) {
  return principal.role === required;
}
