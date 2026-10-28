# Handoff plugin package

Local plugin package with the Handoff skill and the deployed MCP endpoint in `mcp.json`.
It contains no credential. If deploying another instance, change that endpoint before installing.

Install the `plugin/` folder through a local Codex plugin marketplace, complete OAuth, and check
that all five `handoff_*` tools appear. An already-running chat may need to be reopened before
it loads a newly installed plugin. See `../docs/DEPLOY.md` for the service setup.

## Install in Codex (the tested route)

Tested with Codex Desktop 0.164.0 on macOS (`../docs/evidence/codex-plugin-test-2026-10-25/`).
A local marketplace is a folder with `.agents/plugins/marketplace.json`. The tested one was the home
folder, with this file (`path` is relative to that folder):

```json
{
  "name": "acme-local",
  "plugins": [
    {
      "name": "handoff",
      "source": { "source": "local", "path": "./dev/handoff/plugin" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

```sh
codex plugin marketplace add ~      # the folder that holds .agents/plugins/marketplace.json
codex plugin add handoff@acme-local # <plugin name>@<marketplace name>
```

Then start a new Codex chat, sign in with your handle and access code, and check that the five
tools appear. After a package change, raise the version in both manifests and install again.

## Codex compatibility

Keep the MCP server entry to the standard transport and URL fields. Codex Desktop 0.164.0
rejects a nested `mcpServers.handoff.extensions` field and omits the entire server, even when
the plugin appears installed and its skill loads. Version 0.1.1 removes that field. Authentication
still comes from the server's OAuth challenge and discovery metadata; removing the client
extension does not disable OAuth. Native Codex DCR/PKCE login and all five tools were verified
with this entry shape. Other host/account combinations require their own acceptance tests.

`plugin.json` is the portable manifest; `.codex-plugin/plugin.json` is the compatibility overlay.
Keep their versions in sync so a package change does not reuse an older cached installation.
