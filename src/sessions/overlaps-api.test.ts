import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { coordinationOverlaps } from "./overlaps-api";
import { forgetReadApiAccess } from "./read-api";
import { overlapsFixture } from "./overlaps-fixture";

const WORKSPACE = "fake-workspace";
const handoff = {
  baseUrl: "https://read.example.test",
  accessToken: "rth_at_read_fake",
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  tokenType: "Bearer",
  scopes: ["rth:read"],
  workspaceId: WORKSPACE,
};

beforeEach(() => {
  forgetReadApiAccess();
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    sessionReadApi: true,
    coordinationOverlaps: true,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
});

it("treats only the disabled-contract 404 as an unavailable tab", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/session-read/session"))
        return new Response(JSON.stringify(handoff));
      if (url.includes("/sessions/members"))
        return new Response(JSON.stringify({ members: [] }));
      return new Response(
        JSON.stringify({ error: "coordination_overlaps_disabled" }),
        { status: 404 },
      );
    }),
  );
  await expect(
    coordinationOverlaps(
      WORKSPACE,
      { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
      new AbortController().signal,
    ),
  ).resolves.toBeNull();
});

it("makes one workspace-attested read with the exact overlap filters", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/session-read/session"))
        return new Response(JSON.stringify(handoff));
      if (url.includes("/sessions/members"))
        return new Response(
          JSON.stringify({ members: [{ id: "fake-user-one", name: "Example One" }] }),
        );
      return new Response(JSON.stringify(overlapsFixture), {
        headers: { "X-Relayhistory-Workspace-Id": WORKSPACE },
      });
    }),
  );
  const result = await coordinationOverlaps(
    WORKSPACE,
    {
      since: "2026-10-01T00:00:00Z",
      until: "2026-10-08T00:00:00Z",
      project: "example/project",
    },
    new AbortController().signal,
  );
  const reads = calls.filter((url) => url.startsWith("https://read.example.test"));
  expect(reads).toHaveLength(1);
  const url = new URL(reads[0]!);
  expect(url.pathname).toBe("/v1/coordination/overlaps");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    since: "2026-10-01T00:00:00Z",
    until: "2026-10-08T00:00:00Z",
    project: "example/project",
    workspace: WORKSPACE,
  });
  expect(result?.members).toEqual([
    { id: "fake-user-one", name: "Example One" },
  ]);
  expect(result?.report.findings.map((finding) => finding.id)).toEqual([
    "fake-finding-first",
    "fake-finding-second",
  ]);
});

it("keeps other read errors visible to the panel", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/session-read/session"))
        return new Response(JSON.stringify(handoff));
      if (url.includes("/sessions/members"))
        return new Response(JSON.stringify({ members: [] }));
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 404,
      });
    }),
  );
  await expect(
    coordinationOverlaps(
      WORKSPACE,
      { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ reason: "read_404", code: "unexpected" });
});

it("requests nothing and hides the view unless the dashboard enables it", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const config of [
    { sessionReadApi: true },
    { sessionReadApi: true, coordinationOverlaps: false },
    { sessionReadApi: true, coordinationOverlaps: "true" },
  ]) {
    window.__AGENT_RELAY_DASHBOARD_CONFIG__ = config;
    await expect(
      coordinationOverlaps(
        WORKSPACE,
        { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
