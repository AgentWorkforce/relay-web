import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetReadApiAccess } from "./read-api";
import { sessionIntelWorkspace } from "./session-intel-api";
import { sessionIntelFixture } from "./session-intel-fixture";

const WORKSPACE = "fake-workspace";
const handoff = {
  baseUrl: "https://read.example.test",
  accessToken: "rth_at_read_fake",
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  tokenType: "Bearer",
  scopes: ["rth:read"],
  workspaceId: WORKSPACE,
};

function stubRead(read: () => Response, calls: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/session-read/session"))
        return new Response(JSON.stringify(handoff));
      return read();
    }),
  );
  return calls;
}

beforeEach(() => {
  forgetReadApiAccess();
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    sessionReadApi: true,
    sessionIntelEnabled: true,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
});

it("requests nothing unless the dashboard enables the view and the read API", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const config of [
    {},
    { sessionReadApi: true },
    { sessionReadApi: true, sessionIntelEnabled: false },
    { sessionReadApi: true, sessionIntelEnabled: "true" },
    { sessionReadApi: false, sessionIntelEnabled: true },
  ]) {
    window.__AGENT_RELAY_DASHBOARD_CONFIG__ = config;
    await expect(
      sessionIntelWorkspace(WORKSPACE, new AbortController().signal),
    ).resolves.toBeNull();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["session_intel_disabled", "session_intel_not_migrated", "coordination_workspace_not_enabled"])(
  "treats a 501 (%s) as the view being unavailable",
  async (reason) => {
    stubRead(
      () =>
        new Response(
          JSON.stringify({
            error: { code: "unsupported_by_backend", message: "not served", reason },
            correlationId: "fake-correlation",
          }),
          { status: 501 },
        ),
    );
    await expect(
      sessionIntelWorkspace(WORKSPACE, new AbortController().signal),
    ).resolves.toBeNull();
  },
);

it("makes one workspace-attested read of the contract with no other parameter", async () => {
  const calls = stubRead(
    () =>
      new Response(JSON.stringify(sessionIntelFixture), {
        headers: { "X-Relayhistory-Workspace-Id": WORKSPACE },
      }),
  );
  const result = await sessionIntelWorkspace(WORKSPACE, new AbortController().signal);
  const reads = calls.filter((url) => url.startsWith("https://read.example.test"));
  expect(reads).toHaveLength(1);
  const url = new URL(reads[0]!);
  expect(url.pathname).toBe("/v1/session-intel/workspace");
  expect(Object.fromEntries(url.searchParams)).toEqual({ workspace: WORKSPACE });
  expect(result?.alerts.map((alert) => alert.advisoryId)).toEqual(
    sessionIntelFixture.alerts.map((alert) => alert.advisoryId),
  );
});

it("refuses a response another workspace answered", async () => {
  stubRead(
    () =>
      new Response(JSON.stringify(sessionIntelFixture), {
        headers: { "X-Relayhistory-Workspace-Id": "fake-other-workspace" },
      }),
  );
  await expect(
    sessionIntelWorkspace(WORKSPACE, new AbortController().signal),
  ).rejects.toMatchObject({ reason: "workspace_not_attested" });
});

it("keeps other failures visible to the panel", async () => {
  stubRead(() => new Response(JSON.stringify({ error: "backend_unavailable" }), { status: 503 }));
  await expect(
    sessionIntelWorkspace(WORKSPACE, new AbortController().signal),
  ).rejects.toMatchObject({ reason: "read_503" });
  stubRead(
    () =>
      new Response(JSON.stringify({ ...sessionIntelFixture, contract: "session-intel-workspace/2" }), {
        headers: { "X-Relayhistory-Workspace-Id": WORKSPACE },
      }),
  );
  await expect(
    sessionIntelWorkspace(WORKSPACE, new AbortController().signal),
  ).rejects.toThrow();
});
