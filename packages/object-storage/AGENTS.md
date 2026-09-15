# Object storage package scope

- Keep this package as a small S3-compatible adapter; publication ordering and
  object-key policy belong to Content/API callers.
- Require complete storage configuration before creating a client.
- Do not persist or print access keys, secret keys, bucket names, or object
  bodies in diagnostics.
- Preserve text encoding and missing-body errors; run package typecheck/build
  and affected Content tests.
