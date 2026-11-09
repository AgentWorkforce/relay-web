import { afterEach, expect, it, vi } from "vitest";
import { listSessions } from "./api";
import {
  agentDraft,
  completeAgent,
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
  ["@layered-control", "", ["layered-control"]],
  ["@Layered-Control", "", ["layered-control"]],
  ["@layered-control@node", "", ["layered-control@node"]],
  ["@layered-*", "", ["layered-*"]],
  ["@layered-control@no*", "", ["layered-control@no*"]],
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
  expect(serverFilters("@a @b project:relay updated:>=2026-01-01", known)).toMatchObject({
    agent: "a",
    project: undefined,
    since: undefined,
    until: undefined,
  });
  expect(serverFilters("project:relay", known).project).toBe("relay");
});

it("keeps server-filtered rows and still applies other filters to them", () => {
  const row = { source: "codex", projectId: null, project: null, userIds: [] } as unknown as SessionRow;
  expect(matchesSessionFilters(row, "@builder", 0)).toBe(true);
  expect(matchesSessionFilters(row, "@builder harness:claude", 0)).toBe(false);
});

it("completes the @word being typed", () => {
  expect(agentDraft("fix @lay")).toBe("lay");
  expect(agentDraft("@")).toBe("");
  expect(agentDraft("@lay ")).toBeNull();
  expect(agentDraft("me@lay")).toBeNull();
  expect(completeAgent("fix @lay", "layered-control")).toBe("fix @layered-control ");
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
  ["agent_filter_not_ready", /isn’t available on this workspace yet/],
  ["agent_with_text", /can’t be combined/],
  ["agent_prefix_not_supported", /full name/],
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
