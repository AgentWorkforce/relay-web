import { afterEach, expect, it, vi } from "vitest";
import { listSessions } from "./api";
import { ReadError } from "../api/client";
import {
  agentDraft,
  completeAgent,
  clearAgentFilters,
  listServerFilters,
  matchesSessionFilters,
  parseSessionQuery,
  queryAgents,
  serverFilters,
} from "./query";
import type { SessionRow } from "./data";

afterEach(() => vi.unstubAllGlobals());

const signal = () => new AbortController().signal;
const page = { items: [], members: [], nextCursor: null, error: false };

// The same vectors as relaycontrol's test/agent-query.test.ts.
it.each([
  ["@example-agent", "", ["example-agent"]],
  ["@Example-Agent", "", ["example-agent"]],
  ["@example-agent@node", "", ["example-agent@node"]],
  ["@example-*", "", ["example-*"]],
  ["@example-agent@no*", "", ["example-agent@no*"]],
  ["fix the bug @a", "fix the bug", ["a"]],
  ["@a fix @b the bug", "fix the bug", ["a", "b"]],
  ["@a @A @b", "", ["a", "b"]],
  ["@a_b.c-1", "", ["a_b.c-1"]],
  ["  @a \t  two   words ", "two words", ["a"]],
  ["plain text", "plain text", []],
  ["", "", []],
  ["someone@example.com", "someone@example.com", []],
  ["@", "@", []],
  ["@*", "@*", []],
  ["@foo!", "@foo!", []],
  ["@a@b@c", "@a@b@c", []],
  ["@a*b", "@a*b", []],
  ["\"@a\"", "\"@a\"", []],
])("parses %j", (query, text, agents) => {
  expect(parseSessionQuery(query).text).toBe(text);
  expect(queryAgents(query)).toEqual(agents);
});

it("sends only the first agent, and leaves dates and projects to the browser", () => {
  const known = new Set(["relay"]);
  expect(listServerFilters("@a @b project:relay updated:>=2026-01-01", known)).toMatchObject({
    agent: "a",
    project: undefined,
    since: undefined,
    until: undefined,
  });
  expect(listServerFilters("project:relay", known).project).toBe("relay");
});

it("keeps server date and project bounds for message search, which ignores the agent", () => {
  const filters = serverFilters("needle @a project:relay updated:>=2026-01-01", new Set(["relay"]));
  expect(filters).toMatchObject({ q: "needle", project: "relay", since: "2026-01-01" });
  expect(filters).not.toHaveProperty("agent");
});

it("keeps server-filtered rows and still applies other filters to them", () => {
  const row = { source: "codex", projectId: null, project: null, userIds: [] } as unknown as SessionRow;
  expect(matchesSessionFilters(row, "@builder", 0)).toBe(true);
  expect(matchesSessionFilters(row, "@builder harness:claude", 0)).toBe(false);
});

it("completes the @word being typed", () => {
  expect(agentDraft("fix @exa")).toBe("exa");
  expect(agentDraft("@")).toBe("");
  expect(agentDraft("@exa ")).toBeNull();
  expect(agentDraft("me@exa")).toBeNull();
  expect(completeAgent("fix @exa", "example-agent")).toBe("fix @example-agent ");
  expect(agentDraft("@builder@")).toBe("builder@");
  expect(agentDraft("@builder@no")).toBe("builder@no");
  expect(completeAgent("fix @builder@no", "builder@node")).toBe("fix @builder@node ");
});

it("asks Control for the agent", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(page));
  vi.stubGlobal("fetch", fetch);
  await listSessions("w1", { agent: "builder" }, null, signal());
  const url = new URL(fetch.mock.calls[0]![0] as string, "https://x");
  expect(url.pathname).toBe("/cloud/api/v1/workspaces/w1/sessions");
  expect(url.searchParams.get("agent")).toBe("builder");
});

it.each([
  ["agent_filter_not_ready", /session agent index isn’t ready/],
  ["agent_with_text", /can’t be combined/],
  ["agent_prefix_not_supported", /full name/],
  ["param_agentMatch", /full name/],
  ["agent_match_not_migrated", /full name/],
])("explains %s", async (reason, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ error: "unsupported_by_backend", reason }, { status: 501 }),
  ));
  await expect(listSessions("w1", { agent: "builder" }, null, signal())).rejects.toThrow(message);
});

it("keeps the generic message for a failure unrelated to agent search", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
  await expect(listSessions("w1", { agent: "builder" }, null, signal())).rejects.toThrow(/Couldn’t load/);
});

it("keeps typed readiness and HTTP status on the mapped refusal", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ error: "unsupported_by_backend", reason: "agent_filter_not_ready" }, { status: 501 }),
  ));
  const failure = await listSessions("w1", { agent: "builder" }, null, signal()).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ReadError);
  expect(failure).toMatchObject({ status: 501, code: "agent_filter_not_ready" });
});

it("describes an old generic 501 as unavailable without inventing readiness state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ error: "unsupported_by_backend" }, { status: 501 }),
  ));
  const failure = await listSessions("w1", { agent: "builder" }, null, signal()).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ReadError);
  expect(failure).toMatchObject({ status: 501, code: "unsupported_by_backend" });
  expect((failure as Error).message).toMatch(/Agent search is unavailable/);
  expect((failure as Error).message).not.toMatch(/index|indexing|ready/);
});

it.each([400, 403, 503])("does not infer readiness from the reason on HTTP %i", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ error: "unsupported_by_backend", reason: "agent_filter_not_ready" }, { status }),
  ));
  const failure = await listSessions("w1", { agent: "builder" }, null, signal()).catch((error: unknown) => error);
  expect(failure).toMatchObject({ status, code: "agent_filter_not_ready" });
  expect((failure as Error).message).toMatch(/Couldn’t load your sessions/);
  expect((failure as Error).message).not.toMatch(/index|Agent search is unavailable/);
});

it("does not apply agent readiness messaging to a non-agent request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ reason: "agent_filter_not_ready" }, { status: 501 }),
  ));
  await expect(listSessions("w1", {}, null, signal())).rejects.toThrow(/Couldn’t load your sessions/);
});

it("clears all parsed agent restrictions and preserves other terms and quoted literals", () => {
  expect(clearAgentFilters('needle @Builder project:"Team repo" @other updated:>=2026-01-01 harness:codex "@literal"'))
    .toBe('needle project:"Team repo" updated:>=2026-01-01 harness:codex "@literal"');
});
