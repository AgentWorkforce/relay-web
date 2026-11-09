import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalytics } from "./analytics";
import { analyticsEnabled } from "./app-path";

const ID = "4dd2e9f2-b6bf-4147-a1bf-c1ab374e4c70";
const page = { event: "dashboard.page_viewed", properties: { page: "sessions" } } as const;
function fixture(status = 202) {
  let enabled = true;
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status }));
  const port = createAnalytics({ enabled: () => enabled, fetch: send, uuid: () => ID });
  return { port, send, enable: (value: boolean) => { enabled = value; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete window.__AGENT_RELAY_DASHBOARD_CONFIG__; });

describe("the authenticated gateway adapter", () => {
  it("uses independent UUIDv4 event IDs when randomUUID is unavailable on an HTTP site", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 202 }));
    const port = createAnalytics({ enabled: () => true, fetch: send });
    port.setContext("signed-in"); port.capture(page); port.capture(page); await vi.runAllTimersAsync();
    const ids = send.mock.calls.map(([, init]) => JSON.parse(init!.body as string).events[0].client_event_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(port.stats().gatewayAccepted).toBe(2);
  });
  it("drops safely if cryptographic randomness itself is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    const send = vi.fn<typeof fetch>();
    const port = createAnalytics({ enabled: () => true, fetch: send });
    port.setContext("signed-in"); port.capture(page); await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled(); expect(port.stats()).toEqual({ queued: 0, gatewayAccepted: 0, dropped: 1 });
  });
  it.each([undefined, false, "true", 1])("is disabled unless runtime config explicitly opts in (%s)", (value) => {
    window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { analyticsEnabled: value };
    expect(analyticsEnabled()).toBe(false);
  });
  it("admits the literal operator boolean only", () => {
    window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { analyticsEnabled: true };
    expect(analyticsEnabled()).toBe(true);
  });
  it("sends nothing while off or before an authenticated context exists", async () => {
    const { port, send, enable } = fixture();
    port.capture(page); enable(false); port.setContext("user/workspace"); port.capture(page);
    await vi.runAllTimersAsync(); expect(send).not.toHaveBeenCalled();
  });
  it("projects only the registered enum and uses same-origin cookies, with no credential or attribution in the body", async () => {
    const { port, send } = fixture(); port.setContext("private-user/private-workspace");
    const input = { ...page, properties: { page: "sessions", query: "secret transcript", sessionId: "private-session", token: "secret-token" } } as const;
    port.capture(input); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0]!;
    expect(url).toBe("/cloud/api/v1/analytics/events");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(options!.body as string)).toEqual({ schema: "agent-relay.analytics.client-batch/v1", client: "dashboard", events: [{ event: "dashboard.page_viewed", properties: { page: "sessions" }, occurred_at: new Date().toISOString(), client_event_id: ID }] });
    expect(port.stats()).toEqual({ queued: 0, gatewayAccepted: 1, dropped: 0 });
  });
  it("refuses an unregistered runtime value rather than stringifying it", async () => {
    const { port, send } = fixture(); port.setContext("signed-in");
    port.capture({ event: "dashboard.page_viewed", properties: { page: "raw-secret-query" } } as unknown as Parameters<typeof port.capture>[0]);
    await vi.runAllTimersAsync(); expect(send).not.toHaveBeenCalled();
  });
  it("retries with the same identity and exact bytes, then counts gateway acceptance separately from collector durability", async () => {
    const { port, send } = fixture();
    send.mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": "1" } }));
    port.setContext("signed-in"); port.capture(page); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![1]!.body).toBe(send.mock.calls[1]![1]!.body);
    expect(port.stats().gatewayAccepted).toBe(1);
  });
  it.each([200, 204, 301, 400, 413, 422])("does not mistake non-gateway success or terminal refusal %s for acceptance", async (status) => {
    const { port, send } = fixture(status); port.setContext("signed-in"); port.capture(page); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1); expect(port.stats()).toEqual({ queued: 0, gatewayAccepted: 0, dropped: 1 });
  });
  it.each([401, 403, 404])("stops on %s until a new context rather than retrying an auth or disabled gateway", async (status) => {
    const { port, send } = fixture(status); port.setContext("a"); port.capture(page); await vi.runAllTimersAsync();
    port.capture(page); await vi.runAllTimersAsync(); expect(send).toHaveBeenCalledTimes(1);
    port.setContext("b"); port.capture(page); await vi.runAllTimersAsync(); expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([429, 500, 503, 507])("bounds repeated %s failures and drops without failing the product", async (status) => {
    const { port, send } = fixture(status); port.setContext("signed-in"); port.capture(page); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(3); expect(port.stats()).toEqual({ queued: 0, gatewayAccepted: 0, dropped: 1 });
  });
  it("bounds transport failures and response-body errors without retaining their text", async () => {
    const { port, send } = fixture(); send.mockRejectedValue(new Error("secret stack"));
    port.setContext("signed-in"); port.capture(page); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(3); expect(JSON.stringify(port.stats())).not.toContain("secret");
  });
  it("bounds buffered events and discards them on sign-out or operator opt-out", async () => {
    const { port, send, enable } = fixture(); port.setContext("signed-in");
    for (let n = 0; n < 100; n++) port.capture(page);
    expect(port.stats()).toMatchObject({ queued: 32, dropped: 68 });
    enable(false); await vi.runAllTimersAsync(); expect(send).not.toHaveBeenCalled();
    expect(port.stats()).toMatchObject({ queued: 0, dropped: 100 });
  });
  it("aborts in-flight work and cannot send an old user's queued event under a new user's context", async () => {
    const { port, send } = fixture(); let resolve!: (value: Response) => void;
    send.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    port.setContext("user-a/workspace-a"); port.capture(page); port.capture(page);
    await vi.advanceTimersByTimeAsync(0); const signal = send.mock.calls[0]![1]!.signal!;
    port.setContext("user-b/workspace-b"); expect(signal.aborted).toBe(true);
    resolve(new Response(null, { status: 202 })); await vi.runAllTimersAsync();
    expect(port.stats()).toEqual({ queued: 0, gatewayAccepted: 0, dropped: 2 });
    port.capture({ event: "dashboard.session_opened", properties: { source: "link" } }); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(2); expect(port.stats().gatewayAccepted).toBe(1);
  });
  it("has a request timeout and finite attempts when the network stalls", async () => {
    const { port, send } = fixture(); send.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    port.setContext("signed-in"); port.capture(page); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(3); expect(port.stats().queued).toBe(0);
  });
  it("drops expired queued work rather than uploading stale events after a long suspension", async () => {
    const { port, send } = fixture(); port.setContext("signed-in"); port.capture(page);
    vi.setSystemTime(Date.now() + 60_000); await vi.runAllTimersAsync(); expect(send).not.toHaveBeenCalled();
  });
  it("stops all pending network and timers on teardown", async () => {
    const { port, send } = fixture(); port.setContext("signed-in"); port.capture(page); port.stop(); await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled(); expect(port.stats().queued).toBe(0);
  });
});
