import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccount } from "../../src/api/client";
import { adminApi } from "../../src/admin/api";
import { getProductCapabilities } from "../../src/features/capabilities";
import {
  listSessions,
  agentNames,
  sessionActivity,
  sessionOutput,
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
  range,
  fixtureClock,
  usage as fixtureUsage,
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
  it("filters activity with the same query semantics as the list and counts cross-midnight evidence", async () => {
    install("busy");
    const window = { first: range(7).from, last: range(7).to };
    for (const q of [
      "billing",
      "@edge*",
      'project:"Edge migration"',
      "nothing-matches-this",
    ]) {
      const activity = await sessionActivity(
        workspace.id,
        { ...window, q },
        signal(),
      );
      const expectedRows = dataset("busy").filter(({ row }) =>
        q === "billing"
          ? row.project.name === "Billing integration"
          : q === "@edge*"
            ? row.agentName === "edge-builder"
            : q.startsWith("project:")
              ? row.project.name === "Edge migration"
              : false,
      );
      for (const day of activity) {
        const expected = expectedRows.filter(({ events }) =>
          events.some((event) => event.ts.startsWith(day.date)),
        );
        expect(day.conversations).toBe(expected.length);
        expect(
          Object.values(day.bySource).reduce((n, count) => n + count, 0),
        ).toBe(expected.length);
      }
    }
    const prefix = await listSessions(
      workspace.id,
      { agent: "edge*" },
      null,
      signal(),
    );
    expect(prefix.items).toHaveLength(5);
    const cross = dataset("busy").find(
      ({ events }) =>
        new Set(events.map((event) => event.ts.slice(0, 10))).size > 1,
    )!;
    expect(cross).toBeTruthy();
    const activity = await sessionActivity(workspace.id, window, signal());
    for (const date of new Set(
      cross.events.map((event) => event.ts.slice(0, 10)),
    )) {
      const expected = dataset("busy").filter(({ events }) =>
        events.some((event) => event.ts.startsWith(date)),
      ).length;
      expect(activity.find((day) => day.date === date)?.conversations).toBe(
        expected,
      );
    }
  });

  it("counts summaries on generation days and keeps fleet timestamps non-null", () => {
    const usage = fixtureUsage("stale", 7).usage;
    const builtDate = dataset("stale").find(
      ({ summary }) => summary.status === "ready",
    )!.summary;
    if (builtDate.status !== "ready")
      throw new Error("Expected recorded summary");
    expect(
      usage.days.find((day) => day.date === builtDate.builtAt.slice(0, 10))
        ?.summaries,
    ).toBe(3);
    expect(
      usage.days.find((day) => day.date === fixtureClock.slice(0, 10))
        ?.summaries,
    ).toBe(0);
    expect(usage.days.reduce((n, day) => n + (day.summaries ?? 0), 0)).toBe(
      usage.totals.summaries,
    );
    const fleet = catalog
      .find((entry) => entry.id === "fleet")!
      .example("small") as {
      body: {
        range: unknown;
        totals: unknown;
        next_cursor: null;
        members: Array<{ machines: Array<{ lastSeenAt: string }> }>;
      };
    };
    expect(fleet.body.range).toEqual(range(30));
    expect(fleet.body.totals).toBeTruthy();
    expect(fleet.body.next_cursor).toBeNull();
    for (const member of fleet.body.members)
      for (const machine of member.machines)
        expect(Number.isFinite(Date.parse(machine.lastSeenAt))).toBe(true);
  });

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
      expect(await agentNames(workspace.id, signal())).toEqual([
        ...new Set(dataset(scenario.id).map(({ row }) => row.agentName)),
      ]);
      expect(await adminApi.workspaces(organization.id)).toEqual([workspace]);
      const window = { first: range(90).from, last: range(90).to };
      const activity = await sessionActivity(workspace.id, window, signal());
      expect(
        activity.reduce((n, day) => n + day.conversations, 0),
      ).toBeGreaterThanOrEqual(dataset(scenario.id).length);
      expect(await sessionOutput(workspace.id, window, signal())).toBeNull();
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
      (await fetch("https://external.example.test/cloud/api/auth/session"))
        .status,
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
