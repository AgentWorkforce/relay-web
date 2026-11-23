import seed from "./fixtures/northstar.json";
import { accountSchema } from "../../src/api/contracts";
import {
  adminContextSchema,
  usageSchema,
  usagePeopleSchema,
  usagePersonSessionsSchema,
} from "../../src/admin/contracts";
import type { SessionModelSummaryView } from "../../src/sessions/model-summary";

/** Stable within the current UTC day, so preview date windows never age out. */
export function scenarioClock(now = new Date()) {
  return `${now.toISOString().slice(0, 10)}T12:00:00.000Z`;
}
export const fixtureClock = scenarioClock();
export const scenarios = [
  {
    id: "small",
    label: "Small team",
    description: "Three people, three machines and six linked sessions.",
  },
  {
    id: "busy",
    label: "Busy team",
    description: "Thirty sessions; use search, project filters and pagination.",
  },
  {
    id: "stale",
    label: "Missing & stale",
    description:
      "Some summaries and token counts are missing; others are older than the session.",
  },
  {
    id: "partial",
    label: "Partial coverage",
    description:
      "Transcripts work; summaries and timing are unsupported. People counts are truncated.",
  },
  {
    id: "empty",
    label: "No sessions",
    description: "A new workspace with members but no recorded work.",
  },
  {
    id: "error",
    label: "Service error",
    description:
      "Session and usage reads fail while the shell remains available.",
  },
  {
    id: "loading",
    label: "Slow service",
    description:
      "Data reads wait 30 seconds; changing scenarios aborts the old preview.",
  },
] as const;
export type ScenarioId = (typeof scenarios)[number]["id"];
export function scenarioId(value: string | null | undefined): ScenarioId {
  return scenarios.find((item) => item.id === value)?.id ?? "small";
}
export const organization = seed.organization;
export const workspace = seed.workspace;
export const members = seed.people.map(({ id, name }) => ({ id, name }));
export const account = accountSchema.parse({
  authenticated: true,
  user: members[0],
  currentWorkspace: workspace,
});
export const context = adminContextSchema.parse({
  user: seed.people[0],
  currentOrganization: { ...organization, role: "owner" },
  currentWorkspace: workspace,
});
const hour = 3_600_000;
const iso = (offset: number) =>
  new Date(Date.parse(fixtureClock) - offset).toISOString();

export function dataset(id: ScenarioId) {
  const count = id === "empty" ? 0 : id === "busy" ? 30 : 6;
  return Array.from({ length: count }, (_, index) => {
    const work = seed.work[index % seed.work.length]!;
    const sessionId = `design-session-${index + 1}`;
    const lastTs = iso(index * hour);
    const firstTs = iso((index + 1) * hour);
    const unavailable = id === "partial" || (id === "stale" && index % 2 === 0);
    const summary: SessionModelSummaryView =
      id === "partial"
        ? { status: "unsupported" }
        : unavailable
          ? { status: "empty", kind: "short", state: null }
          : {
              status: "ready",
              kind: "short",
              summary: work.summary,
              model: "synthetic-model",
              builtAt: id === "stale" ? iso(72 * hour) : lastTs,
              state: {
                state: work.status === "finished" ? "done" : "active",
                classifiedAt: lastTs,
              },
            };
    const row = {
      sessionId,
      source: work.source,
      agentName: work.agent,
      title: work.title,
      taskTitle: work.title,
      summary: null,
      shortSummary: summary.status === "ready" ? summary.summary : null,
      projectId: work.project,
      project: { name: work.project },
      firstTs,
      lastTs,
      eventCount: 4,
      userIds: [seed.people[work.person]!.id],
      models: ["synthetic-model"],
      machineIds: [seed.machines[work.machine]!.id],
      workState: { status: work.status, updatedAt: lastTs },
      totalInputTokens: unavailable ? null : 12500 + index * 800,
      totalOutputTokens: unavailable ? null : 2200 + index * 100,
      catalog: {
        title: work.title,
        gitBranch: `feature/${work.repo}`,
        repoUrl: `https://example.test/northstar/${work.repo}`,
        childSessionCount: 0,
        parentSessionIds: [],
        models: ["synthetic-model"],
      },
    };
    const events = [
      {
        eventId: `${sessionId}-prompt`,
        ts: firstTs,
        kind: "prompt",
        source: work.source,
        userId: seed.people[work.person]!.id,
        content: work.prompt,
      },
      {
        eventId: `${sessionId}-tool`,
        ts: iso((index + 1) * hour - 1000),
        kind: "session_event",
        type: "function_call",
        toolName: "exec_command",
        toolUseId: `${sessionId}-call`,
        source: work.source,
        content: 'exec_command {"cmd":"npm test"}',
      },
      {
        eventId: `${sessionId}-result`,
        ts: iso((index + 1) * hour - 2000),
        kind: "session_event",
        type: "function_call_output",
        toolUseId: `${sessionId}-call`,
        source: work.source,
        content:
          "Process exited with code 0\nOutput:\nFocused tests passed (synthetic).",
      },
      {
        eventId: `${sessionId}-reply`,
        ts: lastTs,
        kind: "assistant",
        source: work.source,
        content: work.result,
      },
    ];
    return { row, summary, events };
  });
}

export function range(days: number) {
  return {
    days,
    from: iso((days - 1) * 24 * hour).slice(0, 10),
    to: fixtureClock.slice(0, 10),
  };
}
export function usage(id: ScenarioId, days = 30) {
  const data = dataset(id);
  const records = Array.from({ length: days }, (_, i) => {
    const date = iso((days - i - 1) * 24 * hour).slice(0, 10);
    const rows = data.filter(({ row }) => row.lastTs.startsWith(date));
    return {
      date,
      activeUsers: new Set(rows.flatMap(({ row }) => row.userIds)).size,
      sessionsUploaded: rows.length,
      searches: new Set(rows.flatMap(({ row }) => row.userIds)).size * 2,
      summaries:
        id === "partial"
          ? null
          : data.filter(
              ({ summary }) =>
                summary.status === "ready" && summary.builtAt.startsWith(date),
            ).length,
    };
  });
  return usageSchema.parse({
    usage: {
      range: range(days),
      days: records,
      totals: {
        activeUsers: new Set(data.flatMap(({ row }) => row.userIds)).size,
        sessionsUploaded: data.length,
        searches: records.reduce((n, day) => n + day.searches, 0),
        summaries:
          id === "partial"
            ? null
            : data.filter(({ summary }) => summary.status === "ready").length,
      },
      unavailable: id === "partial" ? ["summaries"] : [],
    },
  });
}
export function people(id: ScenarioId, days = 30) {
  return usagePeopleSchema.parse({
    people: {
      range: range(days),
      truncated: id === "partial",
      unavailable: [],
      members: seed.people.map((person) => {
        const rows = dataset(id).filter(({ row }) =>
          row.userIds.includes(person.id),
        );
        return {
          userId: person.id,
          name: person.name,
          email: person.email,
          role: person.role,
          sessionsUploaded: rows.length,
          searches:
            new Set(rows.map(({ row }) => row.lastTs.slice(0, 10))).size * 2,
          lastActiveAt: rows[0]?.row.lastTs ?? null,
          lastSessionAt: rows[0]?.row.lastTs ?? null,
          topProjects: [...new Set(rows.map(({ row }) => row.projectId))].map(
            (name) => ({
              name,
              sessions: rows.filter(({ row }) => row.projectId === name).length,
            }),
          ),
        };
      }),
    },
  });
}
export function personSessions(id: ScenarioId, userId: string, days = 30) {
  const person = seed.people.find((person) => person.id === userId);
  if (!person) return null;
  const rows = dataset(id).filter(({ row }) => row.userIds.includes(userId));
  return usagePersonSessionsSchema.parse({
    person: {
      userId: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
    },
    range: range(days),
    rollup: {
      titles: rows.map(({ row }) => row.title),
      projects: people(id, days).people.members.find(
        (p) => p.userId === userId,
      )!.topProjects,
    },
    sessions: rows.map(({ row, summary }) => ({
      ...row,
      summary: summary.status === "ready" ? summary.summary : null,
      workspaceId: workspace.id,
      project: row.project.name,
    })),
    nextCursor: null,
  });
}

// Design proposal only. These are NOT Control or reader response fields.
// Evidence references point to the same synthetic sessions as the real UI.
export const proposedInitiatives = [
  {
    name: "Edge migration",
    status: "Needs a decision",
    progress: "Routing implemented; staging validation pending",
    decision: "Choose a staging hostname so the cache check can run.",
    nextStep: "Validate cache invalidation before rollout.",
    sessionIds: ["design-session-1", "design-session-2"],
  },
  {
    name: "Billing integration",
    status: "Ready for review",
    progress: "Deduplication implemented and recovery guide updated",
    decision: null,
    nextStep: "Review the implementation and recovery guide.",
    sessionIds: ["design-session-3", "design-session-4"],
  },
  {
    name: "Developer experience",
    status: "In progress",
    progress: "Settings entry implemented; keyboard and wording review pending",
    decision: null,
    nextStep: "Review keyboard navigation and setup labels.",
    sessionIds: ["design-session-5", "design-session-6"],
  },
];
export { seed };
