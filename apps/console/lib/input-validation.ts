// Strict input validators used across the admin write surface.
// All errors thrown here are intentionally generic — the `route.ts` layer
// translates them into HTTP 422/400 responses without echoing the input back
// to the client.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACCESS_GROUP_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TWEET_ID_RE = /^\d{8}-\d{3}$/;

const SLUG_MAX_LEN = 80;
const ACCESS_GROUP_MAX_LEN = 60;
const COMMIT_MESSAGE_MAX_LEN = 200;

export class InputValidationError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = 'InputValidationError';
    this.status = status;
  }
}

/**
 * Slug used to build `blog/<slug>/<locale>.mdx`. Lowercase letters, digits,
 * hyphens; no leading/trailing/consecutive hyphens; bounded length.
 *
 * Rejects (examples):
 *   `..`, `../etc`, `foo/bar`, `foo bar`, `foo--bar`, `-foo`, `foo-`,
 *   `foo%2fbar`, anything containing `\` `:` ` ` `\n` `\r`, …
 */
export function validateBlogSlug(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InputValidationError('Invalid slug.');
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > SLUG_MAX_LEN || !SLUG_RE.test(trimmed)) {
    throw new InputValidationError('Invalid slug.');
  }
  return trimmed;
}

/**
 * Access group keys protected access cookies and TOTP config map. Same shape
 * as a slug — letters/digits/single-hyphen segments only.
 */
export function validateAccessGroup(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InputValidationError('Invalid access group.');
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > ACCESS_GROUP_MAX_LEN || !ACCESS_GROUP_RE.test(trimmed)) {
    throw new InputValidationError('Invalid access group.');
  }
  return trimmed;
}

/**
 * Tweet id is server-generated as `YYYYMMDD-NNN`. The route handler reads
 * `[id]` from the URL — validate it before letting it reach the GitHub commit
 * message or any string comparison loop.
 */
export function validateTweetId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InputValidationError('Invalid tweet id.');
  }
  const trimmed = value.trim();
  if (!TWEET_ID_RE.test(trimmed)) {
    throw new InputValidationError('Invalid tweet id.');
  }
  return trimmed;
}

/**
 * Final guard for any string we send to GitHub as a commit message. Strips
 * ASCII control characters (incl. CR/LF) and DEL so callers can't inject
 * extra commit headers if upstream validation is bypassed. Also clips the
 * length to keep summaries readable in the GitHub UI.
 */
export function sanitizeCommitMessage(value: string): string {
  const stripped = value
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 'chore: update content';
  return stripped.length > COMMIT_MESSAGE_MAX_LEN
    ? stripped.slice(0, COMMIT_MESSAGE_MAX_LEN)
    : stripped;
}
