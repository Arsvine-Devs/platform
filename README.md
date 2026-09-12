# ARSVINE ADMIN

Web-only, privacy-preserving content console for private repositories.

## What It Does

- closed multi-user accounts: one Owner and invited Editors, all with password + TOTP
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
- Neon Postgres for accounts, invitations and encrypted private workspace configuration
- persistent rate limiting on Vercel via Upstash Redis (with local fallback)
- `@vercel/analytics` page analytics

## Required Environment Variables

See [.env.example](./.env.example).

## First deployment and migration

1. Add the Neon integration through the Vercel Marketplace so `DATABASE_URL` is provided.
2. Set `OWNER_ADMIN_EMAIL` and a stable `WORKSPACE_SECRETS_ENCRYPTION_KEY` (32 random bytes encoded as base64url), alongside `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, and `ADMIN_TOTP_JSON`.
3. Run `pnpm db:migrate` after pulling the configured environment locally, or run the generated SQL migration through the Neon console.
4. The first login creates the unique Owner and imports the existing GitHub, revalidation, and translation variables into that Owner's encrypted workspace. Thereafter, each member manages their own settings at `/workspace`.

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

## Admin TOTP

`ADMIN_TOTP_JSON` reuses the main site's TOTP algorithm and JSON shape, but should use a dedicated admin secret:

```json
{"current":"JBSWY3DPEHPK3PXP","period":30,"digits":6,"window":1}
```

- Production and Vercel Preview deployments require both password and TOTP.
- Local `next dev` bypasses TOTP by default so the single-user workflow stays fast.
- To test the full MFA flow locally, set `ADMIN_TOTP_ENFORCE_IN_DEV=true`.
- For secret rotation, add a `previous` array:

```json
{"current":"NEWSECRET","previous":["OLDSECRET"],"period":30,"digits":6,"window":1}
```

## Rate Limiting

- Login, publish, tweet write, and tweet retranslate endpoints are rate-limited.
- On Vercel, configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so limits persist across cold starts and multiple instances.
- If Upstash is missing or temporarily unavailable, the app falls back to a process-local `Map`. That fallback is acceptable for local development, but not strong enough as the only production layer.

## Console Routes

- `/login`: account login
- `/library`: personal content library (default)
- `/blog`: blog writing and publishing console
- `/tweets`: tweet publishing panel
- `/workspace`: private repository and translation configuration
- `/members`: Owner-only invitations and account lifecycle
- `/activate`: invite acceptance and TOTP enrollment
- `/`: redirects to `/library`

### X timeline sync

Configure the target X User ID, username and bearer token from `/workspace`. The token is stored inside the encrypted workspace configuration and is never sent to the browser or the public site.

The `/tweets` page provides manual recent sync and resumable backfill. Vercel invokes `/api/cron/x-timeline` once per day using `CRON_SECRET`; the route processes each active workspace that has X configured and keeps the incremental cursor in the encrypted workspace state. Vercel Hobby scheduling is deliberately low-frequency; the site does not depend on real-time delivery.

## Vercel Deployment

1. Create a separate Vercel project for `arsvine-admin`.
2. Set the Node runtime to `24.x` (the repo also declares this in `package.json`).
3. Enable Vercel Authentication for both Preview and Production deployments.
4. Add the required environment variables:

```text
GITHUB_OWNER
GITHUB_REPO
GITHUB_BRANCH
GITHUB_WRITE_TOKEN
SESSION_SECRET
ADMIN_PASSWORD_HASH
ADMIN_TOTP_JSON
PUBLIC_REVALIDATE_URL
PUBLIC_TWEETS_REVALIDATE_URL
PUBLIC_REVALIDATE_SECRET
CRON_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
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
   - Production: all secrets above.
   - Preview: same as Production, so password+TOTP is enforced before merge.
   - Development: optional for local `vercel env pull`; you may omit `ADMIN_TOTP_JSON` unless you also set `ADMIN_TOTP_ENFORCE_IN_DEV=true`.
6. For local parity after linking the project:

```bash
vercel link --yes
vercel env pull .env.local --yes
```

7. Before shipping, verify:
   - wrong password is rejected;
   - correct password + wrong TOTP is rejected;
   - correct password + correct TOTP creates both session and CSRF cookies;
   - rate limiting returns `429` after repeated login attempts.

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
