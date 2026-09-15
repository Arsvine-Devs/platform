# Documentation scope

- Keep human-facing documentation in Simplified Chinese; keep commands, paths,
  identifiers, environment variables, and protocol fields authoritative.
- `README.md` is the landing page and `INDEX.md` is the catalog. Do not make a
  service README or an architecture document a competing root index.
- Keep one canonical owner for commands, environment variables, routes,
  service ownership, and security invariants. Link to manifests or source when
  they are the factual owner.
- Distinguish current, deprecated, planned, and historical behavior. Do not
  document retired repository or X-worker paths as available operations.
- Verify local links, scope entrypoints, commands, and configuration names with
  `corepack pnpm docs:check` and the narrowest affected workspace check.
