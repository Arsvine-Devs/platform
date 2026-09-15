export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_UNAVAILABLE"
  | "CONTROL_API_UNAVAILABLE"
  | "CSRF_INVALID"
  | "INSUFFICIENT_SCOPE"
  | "CORE_DATABASE_UNAVAILABLE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_READY"
  | "PRECONDITION_REQUIRED"
  | "PROTECTED_CONTENT"
  | "PUBLICATION_AUTH_REQUIRED"
  | "PUBLICATION_INVALID"
  | "PUBLICATION_UNAVAILABLE"
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
  id: string;
  role: "owner" | "editor" | null;
  scopes: string[];
};

export type ApiPostVariant = {
  id: string;
  locale: string;
  title: string;
  excerpt: string;
  bodyMdx?: string;
  originLocale: string | null;
  translationState?: string;
  revision: number;
  updatedAt: string;
};

export type ApiPost = {
  id: string;
  slug: string;
  status: string;
  sourceLocale: string;
  pinned: boolean;
  accessMode: "public" | "totp";
  accessGroup: string | null;
  publishedAt: string | null;
  revision: number;
  updatedAt: string;
  tags: string[];
  variants: ApiPostVariant[];
};

export type TweetLocale = "zh-CN" | "zh-TW" | "en" | "ja" | "other";

export type ApiTweet = {
  id: string;
  source: string;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
  content: string;
  lang?: TweetLocale;
  tags?: string[];
  visibility?: "public" | "private" | "hidden";
  pinned?: boolean;
  translations?: Record<string, unknown>;
  origin?: Record<string, unknown>;
  revision: number;
};

export type ApiPublication = {
  releaseId: string;
  pointerKey: string;
  manifestKey: string;
  postCount: number;
  tweetCount: number;
  publishedAt: string;
  realmRevalidated: true;
};

export const API_VERSION = "v1" as const;
