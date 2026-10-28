Test-only signing key pair for the vitest suite. It stands in for the OAuth issuer's JWKS so that
token verification runs the same code path as production. It signs nothing outside the tests.
Regenerate with the one-liner in docs/DEVELOPMENT.md if you ever want a different key.
