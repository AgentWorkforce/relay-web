import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccount } from "../../src/api/client";
import { adminApi } from "../../src/admin/api";
import { getProductCapabilities } from "../../src/features/capabilities";
import {
  listSessions,
  sessionCatalog,
  sessionEvents,
  sessionTiming,
  sessionTurns,
} from "../../src/sessions/api";
import { sessionModelSummary } from "../../src/sessions/model-summary";
import { catalog } from "./catalog";
import { createFixtureFetch, fixtureReply } from "./transport";
import {
  dataset,
  organization,
  proposedInitiatives,
  scenarios,
  seed,
  workspace,
  type ScenarioId,
} from "./scenarios";

const signal = () => new AbortController().signal;
const base = `/cloud/api/v1/workspaces/${workspace.id}/sessions`;
function install(id: ScenarioId) {
  vi.stubGlobal("fetch", createFixtureFetch(id, "http://localhost:3000"));
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("designer fixture contracts", () => {
  for (const scenario of scenarios.filter(
    ({ id }) => id !== "error" && id !== "loading",
  )) {
    it(`${scenario.id}: reads through the production clients and parsers`, async () => {
      install(scenario.id);
      expect((await getAccount(signal())).currentWorkspace?.id).toBe(
        workspace.id,
      );
      expect((await adminApi.context()).currentOrganization.id).toBe(
        organization.id,
      );
      expect((await getProductCapabilities(signal())).usage_people).toBe(true);
      const page = await listSessions(workspace.id, {}, null, signal());
      expect(page.items.length).toBe(Math.min(12, dataset(scenario.id).length));
      const usage = await adminApi.usage(organization.id, 30);
      const people = await adminApi.usagePeople(organization.id, 30);
      expect(usage.totals.sessionsUploaded).toBe(dataset(scenario.id).length);
      expect(
        people.members.reduce(
          (n, person) => n + (person.sessionsUploaded ?? 0),
          0,
        ),
      ).toBe(usage.totals.sessionsUploaded);
      for (const person of people.members) {
        const detail = await adminApi.usagePersonSessions(
          organization.id,
          person.userId,
          30,
          null,
        );
        expect(detail.sessions).toHaveLength(person.sessionsUploaded!);
        for (const item of detail.sessions)
          expect(
            dataset(scenario.id).some(
              ({ row }) =>
                row.sessionId === item.sessionId &&
                row.source === item.source &&
                row.userIds.includes(person.userId),
            ),
          ).toBe(true);
      }
      for (const session of page.items) {
        const events = await sessionEvents(
          workspace.id,
          session,
          null,
          signal(),
        );
        expect(events.events).toHaveLength(session.eventCount!);
        expect(
          (await sessionTurns(workspace.id, session, signal())).turns,
        ).toEqual([]);
        const summary = await sessionModelSummary(
          workspace.id,
          session,
          signal(),
        );
        expect(summary.status).toBe(
          scenario.id === "partial"
            ? "unsupported"
            : scenario.id === "stale" &&
                Number(session.sessionId.split("-").at(-1)) % 2 === 1
              ? "empty"
              : "ready",
        );
        expect(
          (await sessionCatalog(workspace.id, session, signal())).catalog
            ?.title,
        ).toBe(session.title);
        const timing = await sessionTiming(workspace.id, session, signal());
        expect(timing === null).toBe(scenario.id === "partial");
      }
      if (scenario.id === "partial") {
        expect(usage.totals.summaries).toBeNull();
        expect(usage.unavailable).toContain("summaries");
        expect(people.truncated).toBe(true);
      }
    });
  }

  it("paginates the busy team without duplicate or missing sessions and filters projects", async () => {
    install("busy");
    const first = await listSessions(workspace.id, {}, null, signal());
    const second = await listSessions(
      workspace.id,
      {},
      first.nextCursor,
      signal(),
    );
    const third = await listSessions(
      workspace.id,
      {},
      second.nextCursor,
      signal(),
    );
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((row) => row.sessionId)).size).toBe(30);
    expect(third.nextCursor).toBeNull();
    const filtered = await listSessions(
      workspace.id,
      { project: "Edge migration", source: "codex" },
      null,
      signal(),
    );
    expect(filtered.items).toHaveLength(5);
    expect(
      filtered.items.every(
        (row) =>
          row.project?.name === "Edge migration" && row.source === "codex",
      ),
    ).toBe(true);
  });

  it("retains stale summary timestamps and missing token counts", () => {
    const data = dataset("stale");
    expect(data[0]!.row.totalInputTokens).toBeNull();
    const summary = data[1]!.summary;
    expect(summary.status).toBe("ready");
    if (summary.status === "ready")
      expect(summary.builtAt < data[1]!.row.lastTs).toBe(true);
  });

  it("links proposed initiatives to actual synthetic evidence and machine owners", () => {
    const data = dataset("small");
    for (const initiative of proposedInitiatives)
      for (const id of initiative.sessionIds) {
        const session = data.find(({ row }) => row.sessionId === id)!;
        expect(session.row.project.name).toBe(initiative.name);
        expect(session.events.some((event) => event.kind === "assistant")).toBe(
          true,
        );
      }
    for (const { row } of data) {
      const machine = seed.machines.find((machine) =>
        row.machineIds.includes(machine.id),
      );
      expect(row.userIds).toContain(machine?.ownerId);
    }
    for (const entry of catalog)
      expect(() => JSON.stringify(entry.example("small"))).not.toThrow();
  });

  it("refuses external calls, unknown routes, wrong identities and every mutation", async () => {
    const fetch = createFixtureFetch("small", "http://localhost:3000");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect((await fetch(base, { method })).status).toBe(405);
    expect(
      (await fetch("https://agentrelay.com/cloud/api/auth/session")).status,
    ).toBe(405);
    expect((await fetch("/cloud/api/v1/unknown")).status).toBe(404);
    expect(
      (await fetch("/cloud/api/v1/workspaces/another-workspace/sessions"))
        .status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/design-session-1/events?source=claude`)).status,
    ).toBe(404);
    expect((await fetch(`${base}?cursor=-1`)).status).toBe(400);
  });

  it("exposes a real failure state without making the shell fail", async () => {
    install("error");
    await expect(getAccount(signal())).resolves.toBeTruthy();
    await expect(
      listSessions(workspace.id, {}, null, signal()),
    ).rejects.toThrow();
    await expect(adminApi.usage(organization.id, 30)).rejects.toThrow(
      "Synthetic service error",
    );
  });

  it("aborts slow reads and lets a later scenario respond immediately", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const pending = createFixtureFetch("loading", "http://localhost:3000")(
      base,
      { signal: abort.signal },
    );
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    await check;
    expect(vi.getTimerCount()).toBe(0);
    expect(
      (await createFixtureFetch("small", "http://localhost:3000")(base)).status,
    ).toBe(200);
    expect(
      fixtureReply(new URL(base, "http://design.test"), "GET", "loading").delay,
    ).toBe(30000);
  });
});
