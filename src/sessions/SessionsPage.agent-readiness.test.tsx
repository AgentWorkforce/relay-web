import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionsPage } from "./SessionsPage";

const empty = { items: [], members: [], nextCursor: null, error: false };
const recovered = {
  sessionId: "fake-session", source: "codex", title: "needle recovered session",
  projectId: "fake-project", project: { name: "Team repo" },
  firstTs: "2026-11-10T10:00:00Z", lastTs: "2026-11-10T11:00:00Z",
  userIds: [], machineIds: [], eventCount: 1,
};

function route(list: (url: URL) => Response) {
  const calls: URL[] = [];
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://example.test");
    if (url.pathname.endsWith("/session-agent-names")) return Response.json({ names: ["builder", "other"] });
    if (url.pathname.endsWith("/sessions/activity")) return Response.json({ days: [] });
    if (url.pathname.endsWith("/sessions/output")) return Response.json({ output: null, unsupported: true });
    if (url.pathname.endsWith("/sessions")) { calls.push(url); return list(url); }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return { calls, fetch };
}

function show(query = "@builder") {
  return render(<SessionsPage workspaceId="fake-workspace" initialQuery={query} tab="sessions" onSignedOut={() => undefined} />);
}

beforeEach(() => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionReadApi: false };
  window.history.replaceState(null, "", "/");
});
afterEach(() => { vi.unstubAllGlobals(); delete window.__AGENT_RELAY_DASHBOARD_CONFIG__; });

it("shows actual typed readiness failure and no empty-success or zero count", async () => {
  const { calls, fetch } = route(() => Response.json({ error: "unsupported_by_backend", reason: "agent_filter_not_ready" }, { status: 501 }));
  show();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("The session agent index isn’t ready yet");
  expect(within(alert).getByRole("button", { name: "Retry" })).toBeVisible();
  expect(within(alert).getByRole("button", { name: "Clear agent filter" })).toBeVisible();
  expect(screen.queryByText(/^0 sessions/)).not.toBeInTheDocument();
  expect(screen.queryByText(/No sessions found|No sessions match|No sessions yet/)).not.toBeInTheDocument();
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((url) => url.searchParams.get("agent") === "builder")).toBe(true);
  expect(fetch.mock.calls.every((call) => String(call[0]).startsWith("/cloud/api"))).toBe(true);
});

it("keeps old generic 501 unavailable rather than claiming an indexing operation", async () => {
  route(() => Response.json({ error: "unsupported_by_backend" }, { status: 501 }));
  show();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Agent search is unavailable on this backend");
  expect(alert).not.toHaveTextContent(/index|indexing|ready/);
  expect(screen.queryByText(/^0 sessions/)).not.toBeInTheDocument();
});

it("retries the same agent filter and displays the real recovered result", async () => {
  let attempts = 0;
  const { calls } = route(() => ++attempts === 1
    ? Response.json({ reason: "agent_filter_not_ready" }, { status: 501 })
    : Response.json({ ...empty, items: [recovered] }));
  show();
  fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("link", { name: /needle recovered session/ })).toBeVisible();
  expect(calls.length).toBe(2);
  expect(calls.every((url) => url.searchParams.get("agent") === "builder")).toBe(true);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText(/^1 session$/)).toBeVisible();
});

it("clears agent filters only after the explicit action and preserves every other term", async () => {
  const initial = 'needle @builder @other project:"Team repo" updated:>=2026-01-01 harness:codex';
  const expected = 'needle project:"Team repo" updated:>=2026-01-01 harness:codex';
  const { calls } = route((url) => url.searchParams.has("agent")
    ? Response.json({ error: "unsupported_by_backend" }, { status: 501 })
    : Response.json({ ...empty, items: [recovered] }));
  show(initial);
  const alert = await screen.findByRole("alert");
  expect(calls.every((url) => url.searchParams.get("agent") === "builder")).toBe(true);
  fireEvent.click(within(alert).getByRole("button", { name: "Clear agent filter" }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe(expected));
  await waitFor(() => expect(calls.some((url) => !url.searchParams.has("agent"))).toBe(true));
  // The sidebar also fetches an unnarrowed facet page; inspect the list request.
  expect(calls.some((url) => !url.searchParams.has("agent")
    && url.searchParams.get("q") === "needle"
    && url.searchParams.get("source") === "codex")).toBe(true);
  expect(await screen.findByRole("link", { name: /needle recovered session/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Clear agent filter" })).not.toBeInTheDocument();
});

it("still shows an honest successful empty agent result", async () => {
  route(() => Response.json(empty));
  show();
  expect(await screen.findByText("No sessions found for @builder.")).toBeVisible();
  expect(screen.getByText(/^0 sessions$/)).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
