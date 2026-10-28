---
name: Assistant connection report
about: An assistant that would not connect, or one that is not on /connect yet
title: "Assistant: "
labels: host
---

**Assistant and version**
For example "ChatGPT desktop 1.2026.290 on Windows 11", "Claude desktop, Cowork tab, macOS 26".

**How far it got**
Tick what worked:
- [ ] The connector was accepted (address `.../mcp`)
- [ ] Sign-in page opened and accepted the handle and access code
- [ ] `handoff_inbox` listed packets
- [ ] `handoff_read` returned a brief
- [ ] `handoff_read` returned an attachment (text, image, or an original download)
- [ ] `handoff_send` created a packet
- [ ] `handoff_revoke` hid it

**What the assistant showed**
The connector dialog's wording and any error, with screenshots for a desktop app. Never paste an access
code, a token, or a download URL.
