# Threadpacket

Threadpacket sends a packet from one person's AI assistant to another person's assistant: a brief of the work so far, with the original files. Say "send a packet to anna" and your assistant writes a brief (purpose, decisions and their reasons, constraints, next step, references, open questions), attaches the files you choose, and sends it to anna's Threadpacket inbox. In her own assistant (Claude, ChatGPT, Codex, Claude Code or Hermes) she says "continue the packet from joe" and carries on with the original files.

This plugin adds the Threadpacket skill, which tells the assistant how to write a brief and pick up a packet, and connects the Threadpacket server at `https://threadpacket.com/mcp`.

## What you need

A Threadpacket team. Create one at [threadpacket.com/join](https://threadpacket.com/join), or open the invitation link a teammate sent you. The first time a Threadpacket tool runs, your assistant opens a browser page where you sign in with your username and access code. A team has up to 10 people.

## Tools

- `threadpacket_send`: sends a packet (brief and files) to yourself, to one teammate or to the whole team.
- `threadpacket_inbox`: lists your packets, who picked them up and who has not yet, and your unsent files.
- `threadpacket_read`: reads a packet or one of its files. A recipient's first read shows the sender that it was picked up, in which assistant and when.
- `threadpacket_upload_url`: gets a one-time upload address for a file on your computer.
- `threadpacket_revoke`: revokes a packet you sent. Content already read cannot be recalled.
- `threadpacket_invite`: makes an invitation link for a new teammate (team admins only).

## What it sends, and where

- The brief and the title go to threadpacket.com, with the files you chose. Nothing is sent until you ask to send a packet.
- To attach a file from your computer, the assistant calls `threadpacket_upload_url` and runs the `curl` command (macOS, Linux) or `powershell` command (Windows) that the server returns. That command uploads that one file to threadpacket.com and nothing else.
- In Claude apps, attaching a file from the chat needs `threadpacket.com` in Settings > Capabilities > allowed domains. Without it the upload fails with a 403 error.
- Packets are kept 7 days by default and 30 days at most, then deleted. Files are up to 25 MiB each, 10 per packet: PDF, PNG, JPEG, plain text and Markdown.
- Threadpacket stores what you send as you sent it and runs no AI on it. In Threadpacket, only you and the people you sent it to can open it. It is not end-to-end encrypted; the Privacy page says who can technically read it.

[Privacy](https://threadpacket.com/privacy) · [Terms](https://threadpacket.com/terms) · [Help](https://threadpacket.com/contact) · [Source](https://github.com/evgolsh/threadpacket) (MIT)

## Your own server

Threadpacket is open source. If your team runs its own Threadpacket server, change the URL in `.mcp.json` (Claude Code) and `mcp.json` (ChatGPT, Codex) to your server's `/mcp` address before you install.
