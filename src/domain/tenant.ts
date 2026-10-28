/**
 * Tenancy by qualified identity. A member's identity string is `tenant/handle` on the control center and the
 * bare `handle` on a private install (tenant ""). Handles never contain "/", so the forms cannot collide. The
 * string travels unchanged through members, packets, tokens and events; these helpers split and join it.
 */

/** The tenant part of an identity: "" on a private install. */
export const tenantOf = (subject: string): string => {
  const i = subject.indexOf("/");
  return i === -1 ? "" : subject.slice(0, i);
};

/** The handle part of an identity, the name people see. */
export const handleOf = (subject: string): string => {
  const i = subject.indexOf("/");
  return i === -1 ? subject : subject.slice(i + 1);
};

export const qualify = (tenant: string, handle: string): string => (tenant ? `${tenant}/${handle}` : handle);

/** The recipient value that means "every member of this tenant". */
export const teamOf = (tenant: string): string => (tenant ? `${tenant}/*` : "*");

export const isTeam = (recipient: string | null | undefined): boolean => recipient === "*" || (!!recipient && recipient.endsWith("/*"));

/** The recipient as people see it: "*" for the team, otherwise the handle. */
export const shownRecipient = (recipient: string): string => (isTeam(recipient) ? "*" : handleOf(recipient));

/**
 * SQL for "this identity column belongs to the tenant". For a tenant it is the prefix range
 * `col >= 'acme/' AND col < 'acme0'` ("0" is the character after "/"); for a private install ("") it is
 * "contains no slash". Returns the fragment and its bind values, in order.
 */
export function tenantWhere(col: string, tenant: string): { sql: string; binds: string[] } {
  return tenant ? { sql: `(${col} >= ? AND ${col} < ?)`, binds: [`${tenant}/`, `${tenant}0`] } : { sql: `instr(${col}, '/') = 0`, binds: [] };
}

/** Tenant slugs: 3 to 32 of [a-z0-9-], not a path or a word with a meaning here. */
export const RESERVED_TENANTS = new Set(["team", "all", "admin", "console", "api", "www", "handoff", "join", "stats", "connect", "mcp", "oauth", "authorize", "deploy", "v1"]);
export const isValidTenant = (slug: string): boolean => /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug) && !RESERVED_TENANTS.has(slug);
