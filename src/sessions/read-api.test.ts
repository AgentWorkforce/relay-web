import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listSessions, searchSessions, sessionTurns } from "./api";
import { forgetReadApiAccess, ReadApiUnavailable, readApiGet } from "./read-api";

const signal = () => new AbortController().signal;
const WORKSPACE = "ws-1";
const handoff = (over: Record<string, unknown> = {}) => ({
  readApiBaseUrl: "https://read.example.com",
  accessToken: "rth_at_one",
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
  const [, read] = fetch.mock.calls;
  expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  expect(String(read[0])).toBe(`https://read.example.com/v1/sessions?limit=50&workspace=${WORKSPACE}`);
  expect(read[1]?.credentials).toBe("omit");
  expect((read[1]?.headers as Record<string, string>).Authorization).toBe("Bearer rth_at_one");
  expect(page.nextCursor).toBe("ra1:b96l1:x");
  expect(page.items).toHaveLength(1);
});

it("refuses a handoff that gives page scripts a refresh token", async () => {
  const fetch = route((url) =>
    url.includes("/session-read/session")
      ? json(handoff({ refreshToken: "rth_rt_secret" }))
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
])("does not send the token to an untrusted base URL: %s", async (readApiBaseUrl) => {
  route(() => json(handoff({ readApiBaseUrl })));
  await expect(readApiGet(WORKSPACE, "/v1/sessions", {}, signal())).rejects.toBeInstanceOf(ReadApiUnavailable);
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
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/cloud/api/v1/workspaces/ws-1/sessions"))).toBe(false);
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
    if (url.includes("/session-read/session")) return json(handoff({ accessToken: `rth_at_${++handoffs}` }));
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

it("does not end a search silently at the history floor", async () => {
  const fetch = route((url) => {
    if (url.includes("/session-read/session")) return json(handoff());
    if (url.includes("read.example.com")) return attested({ events: [], nextCursor: null, continuation: { backend: "relayhistory", reason: "history_floor", until: "t" } });
    return json({ matches: [], members: [], nextCursor: null });
  });
  await searchSessions(WORKSPACE, { q: "needle" }, null, signal());
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/sessions/search"))).toBe(true);
});
