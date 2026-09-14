# ARSVINE Console

`console.arsvine.com` is the human management interface for the ARSVINE platform.
It uses Auth OIDC for identity and a host-only opaque session cookie. Browser code
does not receive OAuth tokens and the Console has no PostgreSQL, GitHub, COS, or
integration credentials.

## Current flow

```text
Console UI
  -> same-origin Console BFF (/api/control/*)
  -> https://api.arsvine.com/v1/*
  -> Core PostgreSQL
  -> publish command to Content's internal release adapter
  -> immutable Content release in COS
```

The Console manages Core-backed Blog and Tweet records. Public reads are served
by `content.arsvine.com`; Realm consumes that published read plane.

## Routes

- `/login` starts the Auth OIDC flow.
- `/library` lists Core-backed Blog and Tweet records.
- `/blog` edits Blog variants and publishes releases.
- `/tweets` edits Tweet records.
- `/control` shows the OIDC session and Control API principal.
- `/` redirects to `/library`.

Identity security, invitations, passkeys, TOTP, and account lifecycle belong to
`auth.arsvine.com`. The former local login, WebAuthn, Workspace, Members,
Security, GitHub content, X cron, and local database routes are retired.

## Environment

See [.env.example](./.env.example). The required production groups are:

- `SESSION_SECRET` for encrypted server-side Console sessions;
- `AUTH_OIDC_*` for the exact Auth client and `https://api.arsvine.com` resource;
- Upstash REST or standard Redis/Valkey variables for session/rate-limit state;
- optional Vercel Analytics origins.

Do not add Core database, object-storage, GitHub, X, translation-provider, or
legacy local-auth variables to the Console project.

## Local checks

From the platform repository root:

```bash
pnpm --filter arsvine-admin typecheck
pnpm --filter arsvine-admin test
pnpm --filter arsvine-admin build
pnpm --filter arsvine-admin lint
```

The production project is `arsvine-admin`; its canonical origin is
`https://console.arsvine.com`.
