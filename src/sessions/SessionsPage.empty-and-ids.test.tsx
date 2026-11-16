import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionView } from "./SessionView";
import { SessionsPage } from "./SessionsPage";

const empty = { items: [], members: [], nextCursor: null, error: false };
const untitled = {
  sessionId: "acc-doc-poc-1320", source: "codex",
  firstTs: "2026-11-10T10:00:00Z", lastTs: "2026-11-10T11:00:00Z",
  userIds: [], machineIds: [], eventCount: 1,
};

function route(list: (url: URL) => Response) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://example.test");
    if (url.pathname.endsWith("/sessions/activity")) return Response.json({ days: [] });
    if (url.pathname.endsWith("/sessions/output")) return Response.json({ output: null, unsupported: true });
    if (url.pathname.endsWith("/turns")) return Response.json({ turns: [], nextCursor: null });
    if (url.pathname.endsWith("/timing")) return Response.json({ timing: null });
    if (url.pathname.endsWith("/summary")) return Response.json({ summary: { status: "unsupported" } });
    if (url.pathname.endsWith("/catalog"))
      return Response.json({ catalog: null, parents: [], children: [], commitLinks: [], truncated: false });
    if (url.pathname.endsWith("/sessions")) { calls.push(url); return list(url); }
    if (url.pathname.includes("/sessions/")) return Response.json({ ...empty, events: [] });
    return Response.json({ error: "not_found" }, { status: 404 });
  }));
  return calls;
}

const show = (query: string) =>
  render(<SessionsPage workspaceId="fake-workspace" initialQuery={query} tab="sessions" onSignedOut={() => undefined} />);

beforeEach(() => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionReadApi: false };
  window.history.replaceState(null, "", "/");
});
afterEach(() => { vi.unstubAllGlobals(); delete window.__AGENT_RELAY_DASHBOARD_CONFIG__; });

it("says a search found nothing, not that this is a first run, and offers to clear it", async () => {
  const calls = route((url) => Response.json(url.searchParams.get("q") ? empty : { ...empty, items: [untitled] }));
  show("no-such-words");
  const cell = (await screen.findByText("No sessions match this search.")).closest("td")!;
  expect(screen.queryByText(/No sessions yet/)).not.toBeInTheDocument();
  fireEvent.click(within(cell).getByRole("button", { name: "Clear search" }));
  expect(await screen.findByRole("link", { name: /acc-doc-poc-1320/ })).toBeVisible();
  await waitFor(() => expect(calls.at(-1)!.searchParams.has("q")).toBe(false));
});

it("says a filter found nothing when only browser filters are set", async () => {
  route(() => Response.json(empty));
  show("is:finished");
  expect(await screen.findByText("No sessions match this search.")).toBeVisible();
  expect(screen.queryByText(/No sessions yet/)).not.toBeInTheDocument();
});

it("keeps the first-run message for a workspace with no sessions and no search", async () => {
  route(() => Response.json(empty));
  show("");
  expect(await screen.findByText(/No sessions yet\. Connect your computer/)).toBeVisible();
  expect(screen.queryByText("No sessions match this search.")).not.toBeInTheDocument();
});

it("shows a non-UUID session id whole in a list row's generated title", async () => {
  route(() => Response.json({ ...empty, items: [untitled] }));
  show("");
  expect(await screen.findByRole("link", { name: /Session · acc-doc-poc-1320/ })).toBeVisible();
});

it("shows a non-UUID session id whole in the session header", async () => {
  route(() => Response.json(empty));
  render(<SessionView workspaceId="w" sessionId="acc-doc-poc-1320" source="codex" event={null} />);
  expect(await screen.findByRole("heading", { name: "Session · acc-doc-poc-1320" })).toBeVisible();
  expect(screen.queryByText("Session · acc-doc-")).not.toBeInTheDocument();
});
