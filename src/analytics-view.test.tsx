import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { analytics } from "./analytics";
import { Shell } from "./shell/shell";
import { SessionView } from "./sessions/SessionView";
import { getAccount } from "./api/client";
import { sessionEvents } from "./sessions/api";

vi.mock("./api/client", async (original) => ({
  ...(await original<typeof import("./api/client")>()), getAccount: vi.fn(),
}));
vi.mock("./sessions/api", async (original) => ({
  ...(await original<typeof import("./sessions/api")>()),
  sessionEvents: vi.fn(),
  sessionTurns: vi.fn().mockResolvedValue({ turns: [], nextCursor: null }),
  sessionTiming: vi.fn().mockResolvedValue(null),
  sessionCatalog: vi.fn().mockResolvedValue(null),
}));
vi.mock("./sessions/model-summary", () => ({
  sessionModelSummary: vi.fn().mockResolvedValue(null), SessionModelSummary: () => null,
}));
const account = { authenticated: true as const, user: { id: "private-person", name: "Person" }, currentWorkspace: { id: "private-workspace", name: "Workspace" } };
const props = { workspaceId: "private-workspace", sessionId: "private-session", source: "codex", event: null };
const page = { events: [], members: [], nextCursor: null };
beforeEach(() => {
  analytics.stop();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  vi.mocked(getAccount).mockResolvedValue(account);
  vi.mocked(sessionEvents).mockResolvedValue(page);
});
afterEach(() => {
  analytics.stop();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  vi.unstubAllGlobals();
});

it("reports only the fixed page category after the shell authenticates, never its private route or query", async () => {
  const captured = vi.spyOn(analytics, "capture");
  render(<Shell rail="Agents" label="Sessions"><span>Session list</span></Shell>);
  await waitFor(() => expect(captured).toHaveBeenCalledWith({ event: "dashboard.page_viewed", properties: { page: "sessions" } }));
  expect(JSON.stringify(captured.mock.calls)).not.toMatch(/private-person|private-workspace|query|href/);
});
it("does not emit page events before sign-in is established", async () => {
  vi.mocked(getAccount).mockRejectedValue(new Error("signed out"));
  const captured = vi.spyOn(analytics, "capture");
  await act(async () => { render(<Shell rail="Agents" label="Sessions"><span>Not signed in</span></Shell>); });
  expect(captured).not.toHaveBeenCalled();
});
it("does not report a session open for a failed read", async () => {
  vi.mocked(sessionEvents).mockRejectedValue(new Error("unavailable"));
  const captured = vi.spyOn(analytics, "capture");
  await act(async () => { render(<Shell rail="Agents" label="Session"><SessionView {...props} /></Shell>); });
  expect(captured.mock.calls.filter(([input]) => input.event === "dashboard.session_opened")).toEqual([]);
});
it("waits for the transcript and authenticated workspace, emits once, and drops content/ids/query from the event", async () => {
  let resolve!: (value: typeof page) => void;
  vi.mocked(sessionEvents).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const captured = vi.spyOn(analytics, "capture");
  const view = render(<Shell rail="Agents" label="Session"><SessionView {...props} from="q=secret+transcript" /></Shell>);
  await waitFor(() => expect(sessionEvents).toHaveBeenCalled());
  expect(captured.mock.calls.some(([input]) => input.event === "dashboard.session_opened")).toBe(false);
  await act(async () => { resolve(page); });
  await waitFor(() => expect(captured).toHaveBeenCalledWith({ event: "dashboard.session_opened", properties: { source: "search" } }));
  view.rerender(<Shell rail="Agents" label="Session"><SessionView {...props} from="q=secret+transcript" /></Shell>);
  expect(captured.mock.calls.filter(([input]) => input.event === "dashboard.session_opened")).toHaveLength(1);
  expect(JSON.stringify(captured.mock.calls)).not.toMatch(/private-|secret|transcript|codex/);
});
it("does not report an open under a different authenticated workspace", async () => {
  vi.mocked(getAccount).mockResolvedValue({ ...account, currentWorkspace: { id: "other-workspace", name: "Other" } });
  const captured = vi.spyOn(analytics, "capture");
  await act(async () => { render(<Shell rail="Agents" label="Session"><SessionView {...props} /></Shell>); });
  expect(captured.mock.calls.filter(([input]) => input.event === "dashboard.session_opened")).toEqual([]);
});
it("delivers the real successful-view hook through the opt-in adapter without losing it before shell context is ready", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { analyticsEnabled: true };
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", send);
  render(<Shell rail="Agents" label="Session"><SessionView {...props} from="q=private-query" /></Shell>);
  const gatewayCalls = () => send.mock.calls.filter(([url]) => url === "/cloud/api/v1/analytics/events");
  await waitFor(() => {
    const events = gatewayCalls().flatMap(([, options]) => JSON.parse(options!.body as string).events);
    expect(events.some(event => event.event === "dashboard.session_opened" && event.properties.source === "search")).toBe(true);
  });
  for (const [url, options] of gatewayCalls()) {
    expect(url).toBe("/cloud/api/v1/analytics/events");
    expect(options!.credentials).toBe("same-origin");
    expect(String(options!.body)).not.toMatch(/private-|codex|token|tenant_id|workspace_id/);
  }
});
