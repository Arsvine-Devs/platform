# Environment provider scope

- Keep `@arsvine/env` limited to configuration loading and primitive value
  normalization. Service policy belongs to the service that consumes it.
- Keep `./dotenv` Node-only. Do not import it from browser, Next Proxy, or Edge
  code.
- Never print environment values from the provider or its CLI. Secret status is
  sufficient for statistics and queries.
- Register every user-configurable key in `config/env-contracts.json` and the
  owning service `.env.example` through the root CLI.
