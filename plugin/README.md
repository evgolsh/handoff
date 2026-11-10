# Handoff

Handoff passes work from your AI assistant to another person's assistant, or to your own assistant on another
computer. Say "hand this off to anna" and your assistant writes a brief (purpose, decisions and their reasons,
constraints, next step, references, open questions), attaches the files you choose, and sends it to anna's
Handoff inbox. In her own assistant (Claude, ChatGPT, Codex or Claude Code) she says "continue the handoff from
joe" and carries on with the original files.

This plugin adds the Handoff skill, which tells the assistant how to write a brief and pick one up, and connects
the Handoff server at `https://handoff.infraworks.net/mcp`.

## What you need

A Handoff team. Create one at [handoff.infraworks.net/join](https://handoff.infraworks.net/join), or open the
invitation link a teammate sent you. The first time a Handoff tool runs, your assistant opens a browser page where
you sign in with your username and access code. A team has up to 10 people.

## Tools

- `handoff_send`: sends a brief, with files, to yourself, to one teammate or to the whole team.
- `handoff_inbox`: lists your handoffs, who picked them up and who has not yet, and your unsent files.
- `handoff_read`: reads a handoff or one of its files. A recipient's first read shows the sender that it was
  picked up, in which assistant and when.
- `handoff_upload_url`: gets a one-time upload address for a file on your computer.
- `handoff_revoke`: takes back a handoff you sent. Content already read cannot be recalled.
- `handoff_invite`: makes an invitation link for a new teammate (team admins only).

## What it sends, and where

- The brief and the title go to handoff.infraworks.net, with the files you chose. Nothing is sent until you ask
  for a handoff.
- To attach a file from your computer, the assistant calls `handoff_upload_url` and runs the `curl` command
  (macOS, Linux) or `powershell` command (Windows) that the server returns. That command uploads that one file
  to handoff.infraworks.net and nothing else.
- In Claude apps, attaching a file from the chat needs `handoff.infraworks.net` in Settings > Capabilities >
  allowed domains. Without it the upload fails with a 403 error.
- Handoffs are kept 7 days by default and 30 days at most, then deleted. Files are up to 25 MiB each, 10 per
  handoff: PDF, PNG, JPEG, plain text and Markdown.
- Handoff stores what you send as you sent it and runs no AI on it. In Handoff, only you and the people you sent
  it to can open it. It is not end-to-end encrypted; the Privacy page says who can technically read it.

[Privacy](https://handoff.infraworks.net/privacy) · [Terms](https://handoff.infraworks.net/terms) ·
[Help](https://handoff.infraworks.net/contact) · [Source](https://github.com/evgolsh/handoff) (MIT)

## Your own server

Handoff is open source. If your team runs its own Handoff server, change the URL in `.mcp.json` (Claude Code) and
`mcp.json` (ChatGPT, Codex) to your server's `/mcp` address before you install.
