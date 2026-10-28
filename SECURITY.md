# Security

Handoff is a small service that families and teams run on their own Cloudflare account, so a flaw in it is
a flaw in each of those private deployments. Please report security issues privately.

## Reporting

Use GitHub's private vulnerability reporting on this repository ("Security" tab, "Report a vulnerability")
or email evgolsh@gmail.com with "Handoff security" in the subject. Include the version (the console's Ops page
shows the deployed version id), the steps, and what a member could read or do that they should not.

You will get an acknowledgement within three days. Please give us a reasonable time to ship a fix before
describing the issue in public.

## In scope

Anything that breaks the rules in the README's "Security model" section: reading a packet or an attachment
you are not a sender or recipient of, a download URL that outlives its packet or its 10 minutes, sign-in as
another member, a server-side import that reaches a host outside the allowlist, and access that survives a
code reset, a removed member, or Disconnect.

## Out of scope

Rate limiting and abuse of the public pages (`/`, `/connect`): these are handled by Cloudflare firewall
rules on each deployment, not by the Worker. Reports that need the operator's own Cloudflare account or
GitHub account to be compromised first.
