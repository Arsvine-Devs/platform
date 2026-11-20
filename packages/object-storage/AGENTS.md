# Object storage package scope

- Keep this package as local filesystem storage. Content and API own publication
  ordering, and Content chooses which pointer can be replaced.
- Accept an absolute private storage root. Keep object contents out of diagnostics.
- Preserve text encoding and missing-body errors; run package typecheck/build
  and affected Content tests.
