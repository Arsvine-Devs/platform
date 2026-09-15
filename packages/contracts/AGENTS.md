# Contracts package scope

- Keep this package limited to stable cross-service wire types and version
  constants.
- Add a type here only when at least two service boundaries consume the same
  protocol shape; keep UI-only models in the consuming app.
- Keep names and optionality aligned with the current API payloads and route
  schemas.
- Type-only changes require the affected app typechecks; do not add runtime
  dependencies without a protocol need.
