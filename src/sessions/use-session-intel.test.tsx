import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionIntelPanel } from "./SessionIntelPanel";
import type { SessionIntelResponse } from "./session-intel-api";
import { sessionIntelFixture } from "./session-intel-fixture";
import { SESSION_INTEL_REFRESH_MS, useSessionIntel } from "./use-session-intel";

type Loader = (workspace: string, signal: AbortSignal) => Promise<SessionIntelResponse | null>;
type Call = { workspace: string; signal: AbortSignal; resolve: (value: SessionIntelResponse | null) => void; reject: (error: Error) => void };

function controlledLoader() {
  const calls: Call[] = [];
  const load = vi.fn<Loader>(
    (workspace, signal) =>
      new Promise((resolve, reject) => calls.push({ workspace, signal, resolve, reject })),
  );
  return { load, calls };
}

let visibility: DocumentVisibilityState = "visible";
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-01T12:00:00.000Z"));
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("refreshes every minute only while the view is open and the page is visible", async () => {
  const { load, calls } = controlledLoader();
  const { rerender } = renderHook(({ active }) => useSessionIntel("fake-workspace", active, load), {
    initialProps: { active: false },
  });
  expect(load).toHaveBeenCalledOnce();
  calls[0]!.resolve(sessionIntelFixture);
  await flush();
  await advance(SESSION_INTEL_REFRESH_MS * 3);
  expect(load).toHaveBeenCalledOnce();

  rerender({ active: true });
  await advance(SESSION_INTEL_REFRESH_MS);
  expect(load).toHaveBeenCalledTimes(2);
  calls[1]!.resolve(sessionIntelFixture);
  await flush();

  visibility = "hidden";
  await advance(SESSION_INTEL_REFRESH_MS * 3);
  expect(load).toHaveBeenCalledTimes(2);
  visibility = "visible";
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(load).toHaveBeenCalledTimes(3);
});

it("never overlaps requests, from the timer or the refresh button", async () => {
  const { load, calls } = controlledLoader();
  const { result } = renderHook(() => useSessionIntel("fake-workspace", true, load));
  calls[0]!.resolve(sessionIntelFixture);
  await flush();
  await advance(SESSION_INTEL_REFRESH_MS);
  expect(load).toHaveBeenCalledTimes(2);
  expect(result.current.refreshing).toBe(true);
  // The second request never answers: no tick or click starts another.
  await advance(SESSION_INTEL_REFRESH_MS * 3);
  act(() => result.current.refresh());
  expect(load).toHaveBeenCalledTimes(2);
  calls[1]!.resolve(sessionIntelFixture);
  await flush();
  act(() => result.current.refresh());
  expect(load).toHaveBeenCalledTimes(3);
});

it("aborts the in-flight read and ignores its answer when the workspace changes", async () => {
  const { load, calls } = controlledLoader();
  const { result, rerender } = renderHook(({ workspace }) => useSessionIntel(workspace, true, load), {
    initialProps: { workspace: "fake-workspace-a" },
  });
  rerender({ workspace: "fake-workspace-b" });
  expect(calls[0]!.signal.aborted).toBe(true);
  expect(calls[1]!.workspace).toBe("fake-workspace-b");
  calls[0]!.resolve(sessionIntelFixture);
  await flush();
  expect(result.current.loading).toBe(true);
  expect(result.current.data).toBeUndefined();
  calls[1]!.resolve(null);
  await flush();
  expect(result.current.data).toBeNull();
});

it("clears its timers and aborts on unmount", async () => {
  const { load, calls } = controlledLoader();
  const { unmount } = renderHook(() => useSessionIntel("fake-workspace", true, load));
  calls[0]!.resolve(sessionIntelFixture);
  await flush();
  await advance(SESSION_INTEL_REFRESH_MS);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  unmount();
  expect(calls[1]!.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await advance(SESSION_INTEL_REFRESH_MS * 3);
  expect(load).toHaveBeenCalledTimes(2);
});

it("keeps the last good view when a refresh fails, and clears the failure on the next success", async () => {
  const { load, calls } = controlledLoader();
  const { result } = renderHook(() => useSessionIntel("fake-workspace", true, load));
  calls[0]!.resolve(sessionIntelFixture);
  await flush();
  const updatedAt = result.current.updatedAt;
  await advance(SESSION_INTEL_REFRESH_MS);
  calls[1]!.reject(new Error("Session history is temporarily unavailable. Please try again."));
  await flush();
  expect(result.current.data).toBe(sessionIntelFixture);
  expect(result.current.error).toBeNull();
  expect(result.current.refreshError?.message).toMatch(/temporarily unavailable/);
  expect(result.current.updatedAt).toBe(updatedAt);
  // A refresh that finds the view no longer served keeps it too: the first load decides the tab.
  await advance(SESSION_INTEL_REFRESH_MS);
  calls[2]!.resolve(null);
  await flush();
  expect(result.current.data).toBe(sessionIntelFixture);
  await advance(SESSION_INTEL_REFRESH_MS);
  const next = structuredClone(sessionIntelFixture);
  calls[3]!.resolve(next);
  await flush();
  expect(result.current.data).toBe(next);
  expect(result.current.refreshError).toBeNull();
  expect(result.current.updatedAt).toBe(Date.now());
});

it("shows the refresh failure note with the last good view", () => {
  render(
    <SessionIntelPanel
      workspaceId="fake-workspace"
      query=""
      data={sessionIntelFixture}
      loading={false}
      error={null}
      updatedAt={Date.now() - 120_000}
      refreshError={new Error("Session history is temporarily unavailable. Please try again.")}
      onRefresh={() => undefined}
    />,
  );
  expect(screen.getByText("Refresh failed, retrying.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Alerts" })).toBeVisible();
  expect(screen.getByText(/Updated 2m ago/)).toBeVisible();
});

it("advances relative ages with the clock and calls refresh from the button", async () => {
  const onRefresh = vi.fn();
  const data = structuredClone(sessionIntelFixture);
  data.status[0]!.lastActivityAt = new Date(Date.now() - 120_000).toISOString();
  render(
    <SessionIntelPanel
      workspaceId="fake-workspace"
      query=""
      data={data}
      loading={false}
      error={null}
      updatedAt={Date.now()}
      onRefresh={onRefresh}
    />,
  );
  expect(screen.getByText(/Updated just now/)).toBeVisible();
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("2m ago");
  await advance(60_000);
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("3m ago");
  expect(screen.getByText(/Updated 1m ago/)).toBeVisible();
  const button = screen.getByRole("button", { name: "Refresh session intelligence" });
  expect(button.className).toContain("min-h-11");
  act(() => button.click());
  expect(onRefresh).toHaveBeenCalledOnce();
});
