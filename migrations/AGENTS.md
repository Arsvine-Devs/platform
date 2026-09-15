# Migration scope

- Treat migration SQL as durable data changes. Do not rewrite an applied
  migration to repair history; add an additive migration when required.
- Keep `packages/core-db/src/schema.ts` and migration state aligned.
- Database writes require explicit authorization and a reversible verification
  plan. Local typecheck/build gates do not prove a remote database migrated.
- Do not put credentials or copied production data in migration files.
