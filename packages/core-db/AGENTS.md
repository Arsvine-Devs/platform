# Core DB package scope

- Keep database access and schema ownership here; callers use explicit query
  functions rather than importing Drizzle tables into UI or route adapters.
- Preserve transaction boundaries, actor attribution, revision checks, and
  cascade behavior.
- Any schema change requires a matching migration and a focused database
  verification plan; do not silently alter persisted formats.
- Never log connection strings or full content bodies.
