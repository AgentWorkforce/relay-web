// Session reads against the control plane (`/cloud/api/v1/workspaces/:id/sessions…`).
// The control plane scopes every read to the signed-in workspace.
import { z } from "zod";
import { read, ReadError } from "../api/client";
import { sessionAgentNamesEnabled } from "../app-path";
import { sessionRow, type Member, type SessionRow } from "./data";
import {
  fromDirectCursor,
  ReadApiUnavailable,
  readApiEnabled,
  readApiGet,
  rememberMembers,
  toDirectCursor,
  viaReadApi,
} from "./read-api";

const record = z.record(z.string(), z.unknown());
const memberRows = z.array(
  z.object({ id: z.string(), name: z.string().nullish() }),
);
const toMembers = (rows: z.infer<typeof memberRows>): Member[] =>
  rows.map((row) => ({ id: row.id, name: row.name ?? null }));
const members = memberRows.default([]).transform(toMembers);
const cursor = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const listSchema = z.object({
  items: z.array(
    record.refine(
      (row) =>
        typeof row.sessionId === "string" && typeof row.source === "string",
    ),
  ),
  members,
  nextCursor: cursor,
  error: z.boolean(),
  now: z.string().nullish(),
});

export type SessionPage = {
  items: SessionRow[];
  members: Member[];
  nextCursor: string | null;
  now: string | null;
};

export class HistoryUnavailable extends Error {
  constructor() {
    super("Session history is temporarily unavailable. Please try again.");
  }
}

const path = (workspace: string, suffix = "") =>
  `/v1/workspaces/${encodeURIComponent(workspace)}/sessions${suffix}`;

function query(entries: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(entries)) {
    if (value) params.set(name, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export type ListFilters = {
  q?: string;
  agent?: string;
  source?: string;
  project?: string;
  since?: string;
  until?: string;
};

/** What relaycontrol's refusal of an agent search means for the person searching. */
const AGENT_SEARCH_MESSAGES: Record<string, string> = {
  agent_with_text: "Search by agent can’t be combined with other words yet. Remove the words or the @name.",
  agent_prefix_not_supported: "Searching by the start of an agent name isn’t available yet. Use the full name.",
  param_agentMatch: "Searching by the start of an agent name isn’t available yet. Use the full name.",
  agent_match_not_migrated: "Searching by the start of an agent name isn’t available yet. Use the full name.",
  agent_prefix_too_short: "Use at least 3 letters or digits before the *.",
  agent_prefix_too_broad: "That matches too many agents. Use more of the name.",
};

/** Names for `@` autocomplete, from the workspace's agent roster. */
export async function agentNames(workspace: string, signal: AbortSignal) {
  const body = z.object({ names: z.array(z.string()) }).parse(
    await read(`/v1/workspaces/${encodeURIComponent(workspace)}/session-agent-names`, signal),
  );
  return body.names;
}

export async function listSessions(
  workspace: string,
  filters: ListFilters,
  next: string | null,
  signal: AbortSignal,
): Promise<SessionPage> {
  // The read API lists by harness only; other filters keep using Control.
  if (readApiEnabled() && !filters.q && !filters.agent && !filters.project && !filters.since && !filters.until) {
    return viaReadApi(
      next,
      signal,
      () => listDirect(workspace, filters.source, next, signal),
      () => listViaControl(workspace, filters, next, signal),
    );
  }
  return listViaControl(workspace, filters, next, signal);
}

/** How long a session read waits for names before showing the sessions without them. */
const MEMBERS_DEADLINE_MS = 3_000;

/**
 * The read API knows no Control users, so names come from Control. The request
 * is shared across callers, so it has its own deadline instead of a caller's
 * signal, and needs a real `members` array so a bad answer is retried.
 */
export function workspaceMembers(workspace: string) {
  return rememberMembers(workspace, async () => {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), MEMBERS_DEADLINE_MS);
    try {
      return z
        .object({ members: memberRows.transform(toMembers) })
        .parse(await read(path(workspace, "/members"), deadline.signal))
        .members;
    } finally {
      clearTimeout(timer);
    }
  });
}

async function listDirect(
  workspace: string,
  source: string | undefined,
  next: string | null,
  signal: AbortSignal,
): Promise<SessionPage> {
  const [body, people] = await Promise.all([
    readApiGet(
      workspace,
      "/v1/sessions",
      {
        limit: "50", source, cursor: fromDirectCursor(next),
        ...(sessionAgentNamesEnabled() ? { includeAgentName: "recorded" } : {}),
      },
      signal,
    ),
    workspaceMembers(workspace),
  ]);
  if (!Array.isArray(body.sessions)) throw new ReadApiUnavailable("list_invalid");
  const rows = z.array(listSchema.shape.items.element).parse(body.sessions);
  return {
    items: rows.map((row) =>
      sessionRow({
        ...row,
        project:
          typeof row.projectId === "string" && row.projectId.trim()
            ? { name: row.projectId }
            : null,
      }),
    ),
    members: people,
    nextCursor: toDirectCursor(body.nextCursor),
    now: new Date().toISOString(),
  };
}

async function listViaControl(
  workspace: string,
  filters: ListFilters,
  next: string | null,
  signal: AbortSignal,
): Promise<SessionPage> {
  const page = listSchema.parse(
    await read(
      path(
        workspace,
        query({
          metadata: "deferred",
          q: filters.q,
          agent: filters.agent,
          source: filters.source,
          project: filters.project,
          since: filters.since,
          until: filters.until,
          cursor: next,
          ...(sessionAgentNamesEnabled() ? { includeAgentName: "recorded" } : {}),
        }),
      ),
      signal,
    ).catch((failure: unknown) => {
      if (!(filters.agent && failure instanceof ReadError)) throw failure;
      let message: string | undefined;
      if (failure.status === 501 && failure.code === "agent_filter_not_ready")
        message = "The session agent index isn’t ready yet. Retry or clear the agent filter.";
      else if (failure.status === 501 && failure.code === "unsupported_by_backend")
        message = "Agent search is unavailable on this backend. Retry or clear the agent filter.";
      else if (failure.code && failure.code !== "agent_filter_not_ready")
        message = AGENT_SEARCH_MESSAGES[failure.code];
      throw message ? new ReadError(message, failure.code, failure.status) : failure;
    }),
  );
  if (page.error) throw new HistoryUnavailable();
  return {
    items: page.items.map(sessionRow),
    members: page.members,
    nextCursor: page.nextCursor,
    now: page.now ?? null,
  };
}

const eventSchema = record.refine(
  (row) => typeof row.eventId === "string" && typeof row.ts === "string",
);

const text = (value: unknown) =>
  typeof value === "string" && value ? value : null;

export type ActivityDay = {
  date: string;
  conversations: number;
  bySource: Record<string, number>;
};

export async function sessionActivity(
  workspace: string,
  range: { first: string; last: string; q?: string },
  signal: AbortSignal,
): Promise<ActivityDay[]> {
  const days = (Date.parse(range.last) - Date.parse(range.first)) / DAY_MS + 1;
  // One read API read covers at most 92 UTC days and has no text filter.
  if (readApiEnabled() && !range.q && days >= 1 && days <= 92) {
    return viaReadApi(
      null,
      signal,
      () => activityDirect(workspace, range, signal),
      () => activityViaControl(workspace, range, signal),
    );
  }
  return activityViaControl(workspace, range, signal);
}

const DAY_MS = 86_400_000;

async function activityDirect(
  workspace: string,
  range: { first: string; last: string },
  signal: AbortSignal,
): Promise<ActivityDay[]> {
  const body = await readApiGet(
    workspace,
    "/v1/sessions/activity",
    {
      since: `${range.first}T00:00:00.000Z`,
      until: new Date(Math.min(Date.parse(range.last) + DAY_MS - 1, Date.now())).toISOString(),
    },
    signal,
  );
  return z
    .array(z.object({ date: z.string(), total: z.number(), bySource: z.record(z.string(), z.number()) }))
    .parse(body.days)
    .map((day) => ({
      date: day.date,
      conversations: day.total,
      bySource: Object.fromEntries(Object.entries(day.bySource).filter(([, count]) => count > 0)),
    }));
}

async function activityViaControl(
  workspace: string,
  range: { first: string; last: string; q?: string },
  signal: AbortSignal,
): Promise<ActivityDay[]> {
  return z
    .object({
      days: z.array(
        z.object({
          date: z.string(),
          conversations: z.number(),
          bySource: z.record(z.string(), z.number()),
        }),
      ),
    })
    .parse(await read(path(workspace, `/activity${query(range)}`), signal))
    .days;
}

export type SessionOutput = {
  agentMessages: number;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  commitsWithoutLineCounts: number;
};

export async function sessionOutput(
  workspace: string,
  range: { first: string; last: string },
  signal: AbortSignal,
): Promise<SessionOutput | null> {
  const body = z
    .object({
      output: z
        .object({
          agentMessages: z.number(),
          commits: z.number(),
          linesAdded: z.number(),
          linesRemoved: z.number(),
          commitsWithoutLineCounts: z.number(),
        })
        .nullable(),
    })
    .parse(await read(path(workspace, `/output${query(range)}`), signal));
  return body.output;
}

const sessionPath = (workspace: string, sessionId: string, resource: string) =>
  path(workspace, `/${encodeURIComponent(sessionId)}/${resource}`);

export async function sessionEvents(
  workspace: string,
  session: { sessionId: string; source: string },
  next: string | null,
  signal: AbortSignal,
) {
  return viaReadApi(
    next,
    signal,
    () => eventsDirect(workspace, session, next, signal),
    () => eventsViaControl(workspace, session, next, signal),
  );
}

async function eventsDirect(
  workspace: string,
  session: { sessionId: string; source: string },
  next: string | null,
  signal: AbortSignal,
) {
  const [body, people] = await Promise.all([
    readApiGet(
      workspace,
      `/v1/sessions/${encodeURIComponent(session.sessionId)}/events`,
      {
        source: session.source,
        order: "asc",
        limit: "500",
        maxContent: "100000",
        cursor: fromDirectCursor(next),
      },
      signal,
    ),
    workspaceMembers(workspace),
  ]);
  const events = z.array(eventSchema).parse(body.events).sort((left, right) =>
    Date.parse(String(left.ts)) - Date.parse(String(right.ts)) ||
    String(left.eventId).localeCompare(String(right.eventId)),
  );
  return { events, members: people, nextCursor: toDirectCursor(body.nextCursor) };
}

async function eventsViaControl(
  workspace: string,
  session: { sessionId: string; source: string },
  next: string | null,
  signal: AbortSignal,
) {
  const body = z
    .object({
      events: z.array(eventSchema),
      members,
      nextCursor: cursor,
      error: z.boolean().optional(),
    })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "events")}${query({
          source: session.source,
          limit: "500",
          cursor: next,
        })}`,
        signal,
      ),
    );
  if (body.error) throw new HistoryUnavailable();
  return { events: body.events, members: body.members, nextCursor: body.nextCursor };
}

export async function sessionTurns(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
  next: string | null = null,
) {
  return viaReadApi(
    next,
    signal,
    async () => {
      const body = await readApiGet(
        workspace,
        `/v1/sessions/${encodeURIComponent(session.sessionId)}/turns`,
        { source: session.source, cursor: fromDirectCursor(next) },
        signal,
      );
      const turns = z.array(record).parse(body.turns).filter((turn) =>
        typeof turn.id === "string" && turn.id !== "" &&
        typeof turn.ts === "string" && Number.isFinite(Date.parse(turn.ts)),
      );
      return { turns, nextCursor: toDirectCursor(body.nextCursor) };
    },
    () => turnsViaControl(workspace, session, next, signal),
  );
}

async function turnsViaControl(
  workspace: string,
  session: { sessionId: string; source: string },
  next: string | null,
  signal: AbortSignal,
) {
  return z
    .object({ turns: z.array(record), nextCursor: cursor })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "turns")}${query({ source: session.source, cursor: next })}`,
        signal,
      ),
    );
}

export type SessionTiming = {
  startedAt: string | null;
  lastActionAt: string | null;
  workMs: number | null;
  waitingMs: number | null;
  coverage?: Record<string, unknown>;
};

export async function sessionTiming(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
): Promise<SessionTiming | null> {
  return z
    .object({
      timing: z
        .object({
          startedAt: z.string().nullable(),
          lastActionAt: z.string().nullable(),
          workMs: z.number().nullable(),
          waitingMs: z.number().nullable(),
          coverage: record.optional(),
        })
        .nullable(),
    })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "timing")}${query({ source: session.source })}`,
        signal,
      ),
    ).timing;
}

export type SessionEdge = {
  parentSessionId: string;
  childSessionId: string;
  relationship: string | null;
  childAgentType: string | null;
  childAgentName: string | null;
  childModel: string | null;
  spawnedAt: string | null;
};

export type SessionCatalog = {
  catalog: Record<string, unknown> | null;
  parents: SessionEdge[];
  children: SessionEdge[];
  commitLinks: Record<string, unknown>[];
  truncated: boolean;
};

function edge(value: Record<string, unknown>): SessionEdge | null {
  const parent = text(value.parentSessionId);
  const child = text(value.childSessionId);
  return parent && child
    ? {
        parentSessionId: parent,
        childSessionId: child,
        relationship: text(value.relationship),
        childAgentType: text(value.childAgentType),
        childAgentName: text(value.childAgentName),
        childModel: text(value.childModel),
        spawnedAt: text(value.spawnedAt),
      }
    : null;
}

export async function sessionCatalog(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
): Promise<SessionCatalog> {
  const body = z
    .object({
      catalog: record.nullable(),
      parents: z.array(record),
      children: z.array(record),
      commitLinks: z.array(record).default([]),
      truncated: z.boolean().default(false),
    })
    .parse(
      await read(
        `${sessionPath(workspace, session.sessionId, "catalog")}${query({ source: session.source })}`,
        signal,
      ),
    );
  return {
    catalog: body.catalog,
    parents: body.parents.map(edge).filter((row): row is SessionEdge => !!row),
    children: body.children
      .map(edge)
      .filter((row): row is SessionEdge => !!row),
    commitLinks: body.commitLinks,
    truncated: body.truncated,
  };
}
