import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listSessions, sessionEvents, sessionTurns } from "./api";
import { forgetReadApiAccess, ReadApiUnavailable, readApiGet } from "./read-api";

const signal = () => new AbortController().signal;
const WORKSPACE = "ws-1";
const handoff = (over: Record<string, unknown> = {}) => ({
  baseUrl: "https://read.example.com",
  accessToken: "rth_at_read_one",
  accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  tokenType: "Bearer",
  scopes: ["rth:read"],
  orgId: "org-1",
  workspaceId: WORKSPACE,
  ...over,
});
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });
const attested = (body: unknown, workspace = WORKSPACE) =>
  json(body, { headers: { "X-Relayhistory-Workspace-Id": workspace } });
const session = { sessionId: "s-1", source: "claude", userIds: [], machineIds: [], firstTs: "2026-11-01T00:00:00Z", lastTs: "2026-11-01T00:01:00Z", eventCount: 1, models: [], projectId: "p" };
const controlPage = { items: [], members: [{ id: "u", name: "U" }], nextCursor: "control-2", error: false };

function route(handler: (url: string, init: RequestInit) => Response) {
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => handler(String(input), init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  forgetReadApiAccess();
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionReadApi: true };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
});

it("stays on Control when the setting is off", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {};
  const fetch = route(() => json(controlPage));
  await listSessions(WORKSPACE, {}, null, signal());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toContain(`/cloud/api/v1/workspaces/${WORKSPACE}/sessions`);
});

it("reads with an in-memory bearer, sends no cookies and marks the cursor", async () => {
  const fetch = route((url) =>
    url.includes("/session-read/session")
      ? json(handoff())
      : attested({ sessions: [session], nextCursor: "b96l1:x", correlationId: "c" }),
  );
  const page = await listSessions(WORKSPACE, {}, null, signal());
  const read = fetch.mock.calls.find(([url]) => String(url).startsWith("https://read.example.com"))!;
  expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  expect(String(read[0])).toBe(`https://read.example.com/v1/sessions?limit=50&workspace=${WORKSPACE}`);
  expect(read[1]?.credentials).toBe("omit");
  expect((read[1]?.headers as Record<string, string>).Authorization).toBe("Bearer rth_at_read_one");
  expect(page.nextCursor).toBe("ra1:b96l1:x");
  expect(page.items).toHaveLength(1);
});

const MEMBERS_URL = `/cloud/api/v1/workspaces/${WORKSPACE}/sessions/members`;
const direct = (members: () => Response) =>
  route((url) => {
    if (url === MEMBERS_URL) return members();
    if (url.includes("/session-read/session")) return json(handoff());
    return attested({ sessions: [session], events: [], nextCursor: null });
  });
const memberCalls = (fetch: ReturnType<typeof route>) =>
  fetch.mock.calls.filter(([url]) => String(url) === MEMBERS_URL);

it("attaches Control's names in direct mode, loading them once per workspace", async () => {
  const names = [{ id: "u1", name: "Example Person" }];
  const fetch = direct(() => json({ members: names }));
  const page = await listSessions(WORKSPACE, {}, null, signal());
  const events = await sessionEvents(WORKSPACE, { sessionId: "s-1", source: "claude" }, null, signal());
  expect(page.members).toEqual(names);
  expect(events.members).toEqual(names);
  expect(memberCalls(fetch)).toHaveLength(1);
});

it("doesn't tie the shared names request to one caller's signal", async () => {
  const fetch = direct(() => json({ members: [] }));
  const caller = signal();
  await listSessions(WORKSPACE, {}, null, caller);
  expect(memberCalls(fetch)[0]![1]?.signal).not.toBe(caller);
});

it.each([
  ["a 404 from an older Control", () => json({ error: "not_found" }, { status: 404 })],
  ["a malformed body", () => json({ members: "nope" })],
  ["a 200 without members", () => json({})],
  ["an empty list", () => json({ members: [] })],
])("still lists sessions with no names after %s, and retries next time", async (_label, failure) => {
  const fetch = direct(failure);
  const page = await listSessions(WORKSPACE, {}, null, signal());
  expect(page.members).toEqual([]);
  expect(page.items).toHaveLength(1);
  await listSessions(WORKSPACE, {}, null, signal());
  expect(memberCalls(fetch)).toHaveLength(2);
});

it("shows sessions without names when Control stalls, then retries", async () => {
  vi.useFakeTimers();
  try {
    let stalled = true;
    const fetch = vi.fn((input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === MEMBERS_URL && stalled)
        return new Promise<Response>((_, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      if (url === MEMBERS_URL)
        return Promise.resolve(json({ members: [{ id: "u1", name: "Example Person" }] }));
      if (url.includes("/session-read/session")) return Promise.resolve(json(handoff()));
      return Promise.resolve(attested({ sessions: [session], nextCursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    const loading = listSessions(WORKSPACE, {}, null, signal());
    await vi.advanceTimersByTimeAsync(3_000);
    const page = await loading;
    expect(page.items).toHaveLength(1);
    expect(page.members).toEqual([]);
    stalled = false;
    const next = await listSessions(WORKSPACE, {}, null, signal());
    expect(next.members).toEqual([{ id: "u1", name: "Example Person" }]);
  } finally {
    vi.useRealTimers();
  }
});

it("never asks for the names route on the Control path", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {};
  const fetch = route(() => json(controlPage));
  const page = await listSessions(WORKSPACE, {}, null, signal());
  expect(page.members).toEqual([{ id: "u", name: "U" }]);
  expect(memberCalls(fetch)).toHaveLength(0);
});

it("refuses a handoff that gives page scripts a refresh token", async () => {
  const fetch = route((url) =>
    url.includes("/session-read/session")
      ? json(handoff({ refreshToken: "rth_rt_read_secret" }))
      : json(controlPage),
  );
  const page = await listSessions(WORKSPACE, {}, null, signal());
  expect(page.members).toEqual([{ id: "u", name: "U" }]);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("read.example.com"))).toBe(false);
});

it.each([
  ["http://read.example.com"],
  ["https://read.example.com/path"],
  ["https://user:pw@read.example.com"],
])("does not send the token to an untrusted base URL: %s", async (baseUrl) => {
  route(() => json(handoff({ baseUrl })));
  await expect(readApiGet(WORKSPACE, "/v1/sessions", {}, signal())).rejects.toBeInstanceOf(ReadApiUnavailable);
});

it.each(["rth_rt_read_x", "rth_st_read_x", "sh_at_x"])("refuses a handoff whose access token is really %s", async (accessToken) => {
  route(() => json(handoff({ accessToken })));
  await expect(readApiGet(WORKSPACE, "/v1/sessions", {}, signal())).rejects.toMatchObject({ reason: "handoff_invalid" });
});

it("refuses a handoff scoped to another workspace", async () => {
  route(() => json(handoff({ workspaceId: "ws-other" })));
  await expect(readApiGet(WORKSPACE, "/v1/sessions", {}, signal())).rejects.toMatchObject({ reason: "handoff_invalid" });
});

it("falls back to Control when a first page's workspace is not attested", async () => {
  route((url) => {
    if (url.includes("/session-read/session")) return json(handoff());
    if (url.includes("read.example.com")) return attested({ sessions: [session], nextCursor: null }, "ws-other");
    return json(controlPage);
  });
  expect((await listSessions(WORKSPACE, {}, null, signal())).nextCursor).toBe("control-2");
});

it("never restarts a read API cursor on Control", async () => {
  const fetch = route((url) => (url.includes("/session-read/session") ? json(handoff()) : new Response("", { status: 503 })));
  await expect(listSessions(WORKSPACE, {}, "ra1:b96l1:x", signal())).rejects.toBeInstanceOf(ReadApiUnavailable);
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/cloud/api/v1/workspaces/ws-1/sessions") && String(url) !== MEMBERS_URL)).toBe(false);
});

it("keeps a Control cursor on Control", async () => {
  const fetch = route(() => json(controlPage));
  await listSessions(WORKSPACE, {}, "control-2", signal());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toContain("cursor=control-2");
});

it("keeps filters the read API can't serve on Control", async () => {
  const fetch = route(() => json(controlPage));
  await listSessions(WORKSPACE, { q: "needle" }, null, signal());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toContain("/cloud/api/");
});

it("gets a new access token once after a 401", async () => {
  let handoffs = 0;
  route((url) => {
    if (url.includes("/session-read/session")) return json(handoff({ accessToken: `rth_at_read_${++handoffs}` }));
    return handoffs === 1 ? new Response("", { status: 401 }) : attested({ sessionId: "s-1", turns: [], correlationId: "c" });
  });
  await expect(sessionTurns(WORKSPACE, { sessionId: "s-1", source: "claude" }, signal())).resolves.toEqual({ turns: [], nextCursor: null });
  expect(handoffs).toBe(2);
});

it("asks Control again once the access token nears expiry", async () => {
  let handoffs = 0;
  route((url) => {
    if (url.includes("/session-read/session")) {
      handoffs += 1;
      return json(handoff({ accessTokenExpiresAt: new Date(Date.now() + (handoffs === 1 ? 10_000 : 300_000)).toISOString() }));
    }
    return attested({ sessions: [], nextCursor: null });
  });
  await readApiGet(WORKSPACE, "/v1/sessions", {}, signal());
  await readApiGet(WORKSPACE, "/v1/sessions", {}, signal());
  await readApiGet(WORKSPACE, "/v1/sessions", {}, signal());
  expect(handoffs).toBe(2);
});

