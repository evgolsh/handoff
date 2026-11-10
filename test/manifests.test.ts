import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import lock from "../package-lock.json";
import serverJson from "../server.json";
import gemini from "../gemini-extension.json";
import cursor from "../.cursor-plugin/plugin.json";
import agentPlugin from "../plugin/plugin.json";
import claudePlugin from "../plugin/.claude-plugin/plugin.json";
import codexPlugin from "../plugin/.codex-plugin/plugin.json";
import claudeMcp from "../plugin/.mcp.json";
import agentMcp from "../plugin/mcp.json";

/**
 * The plugin package and the registry entry. Codex caches an installed plugin by version, and the directories
 * reject a listing over their limits, so these fail before a portal does.
 */
describe("plugin manifests", () => {
  it("every manifest carries the package version", () => {
    const versions = {
      "package-lock.json": lock.version,
      "package-lock.json packages['']": (lock.packages as Record<string, { version?: string }>)[""]?.version,
      "server.json": serverJson.version,
      "gemini-extension.json": gemini.version,
      ".cursor-plugin/plugin.json": cursor.version,
      "plugin/plugin.json": agentPlugin.version,
      "plugin/.claude-plugin/plugin.json": claudePlugin.version,
      "plugin/.codex-plugin/plugin.json": codexPlugin.version,
    };
    for (const [file, v] of Object.entries(versions)) expect(v, file).toBe(pkg.version);
  });

  it("the OpenAI listing fits the submission limits and has the four URLs", () => {
    const ui = agentPlugin.extensions["com.openai"].interface;
    expect(ui.displayName.length).toBeLessThanOrEqual(30);
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
    expect(ui.longDescription.length).toBeLessThanOrEqual(4000);
    expect(ui.developerName.length).toBeLessThanOrEqual(80);
    for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"] as const) {
      expect(ui[key], key).toMatch(/^https:\/\/\S+$/);
    }
    const prompts = ui.defaultPrompt;
    expect(prompts.length).toBeLessThanOrEqual(3);
    for (const p of prompts) expect(p.length).toBeLessThanOrEqual(128);
    // Listings may not advertise a price.
    expect(`${ui.shortDescription} ${ui.longDescription}`).not.toMatch(/\bfree\b/i);
  });

  it("has five positive and three negative review cases", () => {
    const cases = agentPlugin.extensions["com.openai"].review.test_cases;
    expect(cases.positive).toHaveLength(5);
    expect(cases.negative).toHaveLength(3);
    for (const c of cases.positive) expect(c.tools_triggered && c.expected_behavior && c.prompt).toBeTruthy();
  });

  it("each host gets the transport type it accepts, on the same server", () => {
    // Anthropic's directory accepts http, sse or ws for a remote server; the Agent Plugins format names streamable-http.
    expect(claudeMcp.mcpServers.handoff).toEqual({ type: "http", url: serverJson.remotes[0]!.url });
    expect(agentMcp.mcpServers.handoff).toEqual({ type: "streamable-http", url: serverJson.remotes[0]!.url });
  });
});
