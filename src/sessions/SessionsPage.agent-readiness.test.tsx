import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetAgentFilterReadiness } from "./agent-readiness";
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
afterEach(() => { vi.unstubAllGlobals(); delete window.__AGENT_RELAY_DASHBOARD_CONFIG__; resetAgentFilterReadiness(); });

const notReady = () => Response.json({ error: "unsupported_by_backend", reason: "agent_filter_not_ready" }, { status: 501 });

it("falls back to a plain-text search with a note when the agent index isn't ready", async () => {
  const { calls, fetch } = route((url) => url.searchParams.has("agent") ? notReady() : Response.json({ ...empty, items: [recovered] }));
  show();
  expect(await screen.findByRole("link", { name: /needle recovered session/ })).toBeVisible();
  // One agent request, refused; then the same words as plain text.
  expect(calls[0]!.searchParams.get("agent")).toBe("builder");
  const list = calls.at(-1)!;
  expect(list.searchParams.has("agent")).toBe(false);
  expect(list.searchParams.get("q")).toBe("@builder");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText(/agent index isn’t ready yet, so @builder is searched as plain text/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Try agent filter again" })).toBeVisible();
  expect(screen.getByText(/^1 session$/)).toBeVisible();
  expect(fetch.mock.calls.every((call) => String(call[0]).startsWith("/cloud/api"))).toBe(true);
});

it("hides agent suggestions once the index is known not to be ready", async () => {
  route((url) => url.searchParams.has("agent") ? notReady() : Response.json(empty));
  show();
  await screen.findByText(/searched as plain text/);
  fireEvent.click(screen.getByRole("button", { name: "Search and filter sessions" }));
  const input = screen.getByRole("combobox", { name: "Search sessions" });
  expect(input).toHaveAttribute("placeholder", "Search sessions or add filters…");
  fireEvent.change(input, { target: { value: "@bu" } });
  expect(screen.queryByRole("listbox", { name: "Agent suggestions" })).not.toBeInTheDocument();
  expect(screen.queryByText("@builder")).not.toBeInTheDocument();
});

it("never sends an agent filter when the operator turned it off", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionReadApi: false, sessionAgentFilter: false };
  const { calls } = route(() => Response.json({ ...empty, items: [recovered] }));
  show("@builder");
  expect(await screen.findByRole("link", { name: /needle recovered session/ })).toBeVisible();
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((url) => !url.searchParams.has("agent") && url.searchParams.get("q") === "@builder")).toBe(true);
  expect(screen.getByText(/searched as plain text/)).toBeVisible();
  // Nothing was refused, so there is nothing to retry.
  expect(screen.queryByRole("button", { name: "Try agent filter again" })).not.toBeInTheDocument();
});

it("keeps old generic 501 unavailable rather than claiming an indexing operation", async () => {
  route(() => Response.json({ error: "unsupported_by_backend" }, { status: 501 }));
  show();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Agent search is unavailable on this backend");
  expect(alert).not.toHaveTextContent(/index|indexing|ready/);
  expect(screen.queryByText(/^0 sessions/)).not.toBeInTheDocument();
});

it("tries the agent filter again on request and shows the real recovered result", async () => {
  let attempts = 0;
  const { calls } = route((url) => url.searchParams.has("agent") && ++attempts === 1
    ? Response.json({ reason: "agent_filter_not_ready" }, { status: 501 })
    : Response.json(url.searchParams.has("agent") ? { ...empty, items: [recovered] } : empty));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Try agent filter again" }));
  expect(await screen.findByRole("link", { name: /needle recovered session/ })).toBeVisible();
  expect(calls.filter((url) => url.searchParams.get("agent") === "builder").length).toBe(2);
  expect(screen.queryByText(/searched as plain text/)).not.toBeInTheDocument();
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
