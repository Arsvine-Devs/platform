export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_READY"
  | "REVISION_CONFLICT"
  | "VALIDATION_FAILED";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export type ApiErrorEnvelope = { error: ApiError };

export type MeResponse = {
  sub: string;
  role: "owner" | "editor";
  scopes: string[];
};

export const API_VERSION = "v1" as const;
