# Observability package scope

- Keep logging deterministic, structured, and concise.
- Allow service/operation/request/release identifiers and safe summaries only;
  never add credentials, Authorization headers, cookies, database URLs, or
  unbounded request bodies.
- Do not turn this package into a vendor SDK or persistence layer.
- Run package typecheck/build and inspect affected logs when changing fields.
