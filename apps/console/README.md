# ARSVINE ADMIN

Web-only, privacy-preserving content console for private repositories.

## What It Does

- closed multi-user accounts: one Owner using FIDO2/WebAuthn security keys and invited Editors using password + TOTP
- signed `HttpOnly` session cookie + readable CSRF cookie
- Markdown writing and live preview
- publish `blog/<slug>/<locale>.mdx` variants into each member's private GitHub content repo
- auto-translate `zh-CN` blog variants into `zh-TW` / `en` drafts using the shared MDX guide
- rebuild `blog-index.json`
- manage `tweets/index.json` and `tweets/YYYY-MM.json` from `/tweets`
- manually sync an X user timeline into the private tweet archive
- run the same X incremental sync once per day through the Vercel Hobby Cron route
- auto-translate and retranslate tweets
- call the public site's `/api/revalidate-content` and `/api/revalidate`
- PostgreSQL for accounts, invitations and encrypted private workspace configuration
- persistent rate limiting through the Redis/Valkey protocol (with local fallback)
- `@vercel/analytics` page analytics

## Required Environment Variables

See [.env.example](./.env.example).

## Toolchain and dependency policy

Use Node 24 with the repository-pinned `pnpm@11.17.0` via Corepack. The workspace applies a 24-hour minimum release age and security overrides for vulnerable transitive packages; use `corepack pnpm install --frozen-lockfile` and `corepack pnpm audit` for reproducible verification.

## First deployment and migration

1. Add the Neon integration through the Vercel Marketplace so `DATABASE_URL` is provided.
2. Set `OWNER_ADMIN_EMAIL` and a stable `WORKSPACE_SECRETS_ENCRYPTION_KEY` (32 random bytes encoded as base64url), alongside `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_JSON`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_NAME`.
3. Run `pnpm db:migrate` after pulling the configured environment locally, or run the generated SQL migrations through the Neon console.
4. The first legacy login creates the unique Owner and imports the existing GitHub, revalidation, and translation variables into that Owner's encrypted workspace. Open `/security`, register the first FIDO2 security key, and confirm a fresh key login. Thereafter, each member manages their own settings at `/workspace`.

The Owner can invite Editors from `/members`. Invitations are single-use, expire after 72 hours, and are delivered by copying the generated link. The Owner never receives an API or UI surface for members' repository settings, content, drafts, or translation credentials.

## Password Hash

Generate `ADMIN_PASSWORD_HASH` with:

```bash
pnpm hash-password -- "your-password"
```

The script prints an `ADMIN_PASSWORD_HASH=...` line that is safe to paste directly into Next's `.env.local`.

At runtime, the hash format is:

```text
scrypt$<base64url-salt>$<base64url-hash>
```

When stored in `.env.local`, each `$` must be escaped as `\$`, otherwise Next will treat it as environment-variable expansion and the login check will fail.

## Owner migration TOTP and Editor TOTP

`ADMIN_TOTP_JSON` is used only to bootstrap or recover the legacy Owner migration path. After the Owner registers a security key, Owner password/TOTP login is disabled. Editor accounts continue to receive their own encrypted TOTP secret during invitation activation.

The migration configuration reuses the main site's TOTP algorithm and JSON shape, but should use a dedicated secret:

```json
{ "current": "JBSWY3DPEHPK3PXP", "period": 30, "digits": 6, "window": 1 }
```

- For secret rotation, add a `previous` array:

```json
{ "current": "NEWSECRET", "previous": ["OLDSECRET"], "period": 30, "digits": 6, "window": 1 }
```

## Owner WebAuthn

Production WebAuthn is fixed to the deployed Admin origin:

```text
WEBAUTHN_RP_ID=ctrl.arsvine.com
WEBAUTHN_ORIGIN=https://ctrl.arsvine.com
WEBAUTHN_RP_NAME=ARSVINE Admin
```

Registration requests a security-key authenticator, a discoverable credential, direct attestation, and user verification. The server requires user presence and verification and rejects credentials reported as multi-device or backed up. AAGUID, attestation format, transport, and device metadata are retained for account review; no vendor-specific allowlist is maintained.

The login page's primary Owner action is “使用安全密钥登录”. The old password + TOTP form remains only for Editors and the one-time Owner migration. Add a second security key from `/security` before relying on a single key as the only recovery path.

Vercel preview URLs are different WebAuthn origins from `ctrl.arsvine.com`. They remain protected by Vercel Authentication and are intended for build, UI, and non-authenticated checks rather than Admin operations.

If every Owner security key is lost, use a protected offline database operation to set the Owner back to `password+totp`, increment `session_version`, revoke the lost credentials, and perform a fresh migration. There is no public Owner password/TOTP fallback endpoint.

## Rate Limiting

- Login, WebAuthn ceremonies, invitation activation, publish, tweet write, and tweet retranslate endpoints are rate-limited.
- Configure `REDIS_URL` for a Redis/Valkey-compatible endpoint so limits persist across cold starts and multiple instances.
- If Upstash is missing or temporarily unavailable, the app falls back to a process-local `Map`. That fallback is acceptable for local development, but not strong enough as the only production layer.

## Console Routes

- `/login`: account login
- `/library`: personal content library (default)
- `/blog`: blog writing and publishing console
- `/tweets`: tweet publishing panel
- `/workspace`: private repository and translation configuration
- `/security`: Owner-only WebAuthn security-key enrollment and management
- `/members`: Owner-only invitations and account lifecycle
- `/activate`: invite acceptance and TOTP enrollment
- `/`: redirects to `/library`

### X timeline sync

Configure the target X User ID and username first from `/workspace`. Selecting the sync method is separate: the account identity can be saved with no token, while the current official X API method asks for a bearer token only when selected. The token is stored inside the encrypted workspace configuration and is never sent to the browser or the public site.

The `/tweets` page provides manual recent sync and resumable backfill. Vercel invokes `/api/cron/x-timeline` once per day using `CRON_SECRET`; the route processes each active workspace that has X configured and keeps the incremental cursor in the encrypted workspace state. Vercel Hobby scheduling is deliberately low-frequency; the site does not depend on real-time delivery.

## Vercel Deployment

1. Create a separate Vercel project for `arsvine-admin`.
2. Set the Node runtime to `24.x` (the repo also declares this in `package.json`).
3. Enable Vercel Authentication for Preview deployments. Production at `ctrl.arsvine.com` uses the application's WebAuthn session.
4. Add the required environment variables:

```text
GITHUB_OWNER
GITHUB_REPO
GITHUB_BRANCH
GITHUB_WRITE_TOKEN
SESSION_SECRET
ADMIN_PASSWORD_HASH
ADMIN_TOTP_JSON
WEBAUTHN_RP_ID
WEBAUTHN_ORIGIN
WEBAUTHN_RP_NAME
PUBLIC_REVALIDATE_URL
PUBLIC_TWEETS_REVALIDATE_URL
PUBLIC_REVALIDATE_SECRET
CRON_SECRET
REDIS_URL
```

If you want tweet or blog auto-translation, also add:

```text
AI_TRANSLATION_BASE_URL
AI_TRANSLATION_API_KEY
AI_TRANSLATION_MODEL
AI_TRANSLATION_THINKING
AI_TRANSLATION_REASONING_EFFORT
```

5. Scope secrets as follows:
   - Production: all required secrets above. Keep `ADMIN_PASSWORD_HASH` and `ADMIN_TOTP_JSON` only until the first Owner key login is confirmed, then remove them.
   - Preview: Vercel Authentication configuration and non-production values needed for build/UI checks; do not add the preview URL to `WEBAUTHN_ORIGIN`.
   - Development: configure a separate `WEBAUTHN_RP_ID=localhost` and `WEBAUTHN_ORIGIN=http://localhost:<port>` only when locally testing WebAuthn.
6. For local parity after linking the project:

```bash
vercel link --yes
vercel env pull .env.local --yes
```

7. Before shipping, verify the first Owner migration, key-only Owner login, Editor password + TOTP login, key enrollment/revocation, challenge replay protection, CSRF protection, and `429` responses after repeated authentication attempts.

## Expected Content Repo Shape

```text
blog/
  my-first-post/
    zh-CN.mdx
    en.mdx
blog-index.json
tweets/
  index.json
  2026-06.json
```

### Example `blog-index.json`

```json
{
  "version": 1,
  "updatedAt": "2026-06-14T12:00:00.000Z",
  "posts": [
    {
      "slug": "my-first-post",
      "date": "2026-06-14",
      "updatedAt": "2026-06-14T12:00:00.000Z",
      "tags": ["Essay"],
      "pinned": false,
      "access": {
        "mode": "public"
      },
      "availableLocales": ["zh-CN", "en"],
      "variants": {
        "zh-CN": {
          "title": "我的第一篇文章",
          "excerpt": "一段简短摘要。"
        },
        "en": {
          "title": "My First Post",
          "excerpt": "A short summary.",
          "originLocale": "zh-CN"
        }
      }
    }
  ]
}
```

### Example post frontmatter

```md
---
title: My First Post
excerpt: A short summary.
date: 2026-06-14
tags:
  - Essay
pinned: false
originLocale: zh-CN
updated: 2026-06-14T12:00:00.000Z
access:
  mode: public
---

Hello world.
```
