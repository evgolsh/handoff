# Development

Requirements: Node 22+ and npm. No Cloudflare account is needed for tests or local runs.

```sh
npm install
npm test          # vitest inside workerd, with local D1 and R2 (139 tests in 16 files on 2026-10-28)
npm run typecheck
```

## Local server

```sh
cp .dev.vars.local.example .dev.vars   # .dev.vars.example lists the deployed Worker's secrets instead
npm run db:migrate:local
npm run dev        # http://localhost:8787
```

With `HANDOFF_ENV=dev`, the tokens in `DEV_TOKENS` are accepted as bearer tokens on requests to
localhost. This exists only for the local server and the MCP Inspector; production ignores `DEV_TOKENS`.

```sh
curl -s http://localhost:8787/mcp -H 'authorization: Bearer dev-alice' \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Layout

- `src/env.ts`: bindings and limits.
- `src/auth/`: the OAuth 2.1 server (`builtin.ts`: registration, sign-in page, token exchange, signing key), bearer verification, the 401 challenge, resource metadata.
- `src/domain/service.ts`: packets, idempotency, attachments, imports, tickets, cleanup. No HTTP or MCP here.
- `src/store/`: the `Repository` and `BlobStore` contracts, with the D1 and R2 implementations.
- `src/http/routes.ts`: upload and download endpoints. `src/http/connect.ts`: the Connect page.
- `src/console/`: the operators' console at `/console` (`docs/CONSOLE.md`). `src/store/events.ts` and `src/store/telemetry.ts`: what it reads (events, revocations); `src/cleanup.ts`: the hourly cleanup.
- `src/mcp/server.ts`: the five tools and the server instructions.
- `migrations/`: D1 schema.
- `plugin/`: the OpenAI plugin package.
- `test/`: the suite. `test/fixtures/test-private-jwk.json` is a test-only signing key: the tests pass it as
  `OAUTH_SIGNING_JWK`, so `test/helpers.ts` can mint the same tokens the Worker issues.

Regenerate the test key if wanted:

```sh
node --input-type=module -e '
import { generateKeyPair, exportJWK } from "jose"; import { writeFileSync } from "node:fs";
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const priv = await exportJWK(privateKey);
Object.assign(priv, { kid: "test-key-1", alg: "ES256" });
writeFileSync("test/fixtures/test-private-jwk.json", JSON.stringify(priv, null, 2));'
```
