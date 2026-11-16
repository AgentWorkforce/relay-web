import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionGroup, sessionRow } from "./data";
import { matchesSessionFilters, matchesSuggestionFragment, sessionSuggestions } from "./query";
import { SessionView } from "./SessionView";
import { SessionsPage } from "./SessionsPage";

const base = { source: "codex", firstTs: "2026-11-10T10:00:00Z", lastTs: "2026-11-10T11:00:00Z", userIds: [], machineIds: [], eventCount: 1 };
const pit = { ...base, sessionId: "pit-session-1", relaygate: { gid: 22, label: "pit" } };
const plain = { ...base, sessionId: "plain-session-1" };
const empty = { items: [], members: [], nextCursor: null, error: false };

function route(catalog: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://example.test");
    if (url.pathname.endsWith("/sessions/activity")) return Response.json({ days: [] });
    if (url.pathname.endsWith("/sessions/output")) return Response.json({ output: null, unsupported: true });
    if (url.pathname.endsWith("/turns")) return Response.json({ turns: [], nextCursor: null });
    if (url.pathname.endsWith("/timing")) return Response.json({ timing: null });
    if (url.pathname.endsWith("/summary")) return Response.json({ summary: { status: "unsupported" } });
    if (url.pathname.endsWith("/catalog"))
      return Response.json({ catalog: null, parents: [], children: [], commitLinks: [], truncated: false, ...catalog });
    if (url.pathname.endsWith("/sessions")) return Response.json({ ...empty, items: [pit, plain] });
    if (url.pathname.includes("/sessions/")) return Response.json({ ...empty, events: [] });
    return Response.json({ error: "not_found" }, { status: 404 });
  }));
}

beforeEach(() => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionReadApi: false };
  window.history.replaceState(null, "", "/");
});
afterEach(() => { vi.unstubAllGlobals(); delete window.__AGENT_RELAY_DASHBOARD_CONFIG__; });

it("reads only a well-formed relaygate group label", () => {
  expect(sessionRow(pit).group).toEqual({ gid: 22, label: "pit" });
  expect(sessionRow(plain).group).toBeNull();
  for (const bad of [null, "pit", { gid: "22", label: "pit" }, { gid: -1, label: "pit" }, { gid: 22, label: "" }, { gid: 22, label: "<b>pit</b>" }, { gid: 22, label: "x".repeat(25) }]) {
    expect(sessionGroup(bad)).toBeNull();
  }
});

it("filters rows by group: and offers only labels present on loaded rows", () => {
  const rows = [sessionRow(pit), sessionRow(plain)];
  const now = Date.parse("2026-11-16T00:00:00Z");
  expect(rows.filter((row) => matchesSessionFilters(row, "group:PIT", now)).map((row) => row.sessionId)).toEqual(["pit-session-1"]);
  expect(rows.filter((row) => matchesSessionFilters(row, "-group:pit", now)).map((row) => row.sessionId)).toEqual(["plain-session-1"]);
  expect(sessionSuggestions(rows, [], now).filter((s) => s.field === "group")).toEqual([{ field: "group", value: "pit", title: "pit", section: "Groups" }]);
  expect(sessionSuggestions([sessionRow(plain)], [], now).some((s) => s.field === "group")).toBe(false);
});

it("completes a multiword group label from an unquoted prefix", () => {
  const team = { field: "group", value: "Team Alpha", title: "Team Alpha", section: "Groups" };
  expect(matchesSuggestionFragment(team, "group:Tea")).toBe(true);
  expect(matchesSuggestionFragment(team, "group:pit")).toBe(false);
  expect(matchesSuggestionFragment(team, "harness:Tea")).toBe(false);
});

it("badges labeled rows in the session list and filters by group from the sidebar", async () => {
  route();
  render(<SessionsPage workspaceId="fake-workspace" initialQuery="" tab="sessions" onSignedOut={() => undefined} />);
  const row = (await screen.findByRole("link", { name: /pit-session-1/ })).closest("tr")!;
  expect(within(row).getByLabelText("Group: pit")).toHaveTextContent("pit");
  const other = screen.getByRole("link", { name: /plain-session-1/ }).closest("tr")!;
  expect(within(other).queryByLabelText(/^Group:/)).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("group", { name: "Filter by group" })).getByRole("button", { name: "pit" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: /plain-session-1/ })).not.toBeInTheDocument());
  expect(screen.getByRole("link", { name: /pit-session-1/ })).toBeVisible();
});

it("hides the group filter when no session has a label", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...empty, items: [plain], days: [] })));
  render(<SessionsPage workspaceId="fake-workspace" initialQuery="" tab="sessions" onSignedOut={() => undefined} />);
  await screen.findByRole("link", { name: /plain-session-1/ });
  expect(screen.queryByRole("group", { name: "Filter by group" })).not.toBeInTheDocument();
});

it("badges the session header from the catalog's relaygate label", async () => {
  route({ relaygate: { gid: 22, label: "pit" } });
  render(<SessionView workspaceId="w" sessionId="pit-session-1" source="codex" event={null} />);
  const identity = await screen.findByRole("group", { name: "Session identity" });
  expect(within(identity).getByLabelText("Group: pit")).toHaveTextContent("pit");
});

it("shows no header badge without a label", async () => {
  route();
  render(<SessionView workspaceId="w" sessionId="plain-session-1" source="codex" event={null} />);
  const identity = await screen.findByRole("group", { name: "Session identity" });
  expect(within(identity).queryByLabelText(/^Group:/)).not.toBeInTheDocument();
});
