# Contributing to Handoff

Thank you for trying Handoff. The most useful contributions right now are reports from real use: an
assistant that would not connect, a step on `/connect` that did not match what you saw, a file that did not
arrive as the original bytes, or a sentence in the docs that sent you the wrong way.

## Reporting

- **A bug or a confusing step:** open an issue with the "Bug or confusing step" template.
- **An assistant that does not connect (or one we have not tested):** use the "Assistant connection report"
  template. Say which assistant and version, on which OS, and what the connector dialog showed. Screenshots
  help. Never paste an access code, a token, or a download URL.
- **A security issue:** do not open an issue. See `SECURITY.md`.

## Running it locally

`docs/DEVELOPMENT.md` has the two commands: `npm test` (the suite runs inside workerd with a local D1 and
R2) and `npm run dev`. `npm run typecheck` runs the TypeScript check. Please run all three before a pull
request.

## Pull requests

- One change per pull request, with a test that fails without it when that is possible.
- Keep the security invariants in the README's "Security model" section. A change to who can read a packet,
  an attachment, or a download URL needs a test for the case it opens and the case it must still refuse.
- Rate limiting stays a Cloudflare firewall rule, not server code.
- Text on the pages and in tool descriptions is written for a person who has never seen Handoff. Say
  what happens, not what the protocol is called.

## Licence

MIT. By contributing you agree that your contribution is licensed under the same terms.
