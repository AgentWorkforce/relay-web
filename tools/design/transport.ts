import {
  account,
  context,
  dataset,
  fixtureClock,
  members,
  organization,
  people,
  personSessions,
  usage,
  workspace,
  type ScenarioId,
} from "./scenarios";

export type FixtureReply = { status: number; body: unknown; delay?: number };
const reply = (body: unknown, status = 200): FixtureReply => ({ status, body });
const missing = () =>
  reply(
    {
      error: "design_route_not_supported",
      message: "This route has no design fixture. No network request was sent.",
    },
    404,
  );

/** Explicit fixtures only. Never forward an unmatched request to a backend. */
export function fixtureReply(
  url: URL,
  method: string,
  scenario: ScenarioId,
): FixtureReply {
  if (url.origin !== "http://design.test" || method.toUpperCase() !== "GET")
    return reply(
      {
        error: "design_request_blocked",
        message: "Design previews allow fixture reads only.",
      },
      405,
    );
  if (!url.pathname.startsWith("/cloud/api/")) return missing();
  const path = url.pathname.replace(/^\/cloud\/api/, "");
  if (path === "/auth/session") return reply(account);
  if (path === "/v1/auth/whoami") return reply(context);
  if (path === "/v1/capabilities")
    return reply({
      capabilities: {
        flows: false,
        chief: false,
        relayfile: false,
        usage: true,
        usage_people: true,
        session_delete: false,
        session_access: false,
      },
    });
  if (path === "/v1/auth/login-config")
    return reply({ error: "not_configured" }, 404);
  const dataRead =
    path.startsWith(`/v1/workspaces/${workspace.id}/sessions`) ||
    path.startsWith(`/v1/organizations/${organization.id}/usage`);
  if (dataRead && scenario === "error")
    return reply(
      {
        error: "synthetic_service_unavailable",
        message: "Synthetic service error. Switch scenarios to recover.",
      },
      503,
    );
  const result = route(path, url.searchParams, scenario);
  return dataRead && scenario === "loading"
    ? { ...result, delay: 30_000 }
    : result;
}

function route(
  path: string,
  query: URLSearchParams,
  scenario: ScenarioId,
): FixtureReply {
  const rows = dataset(scenario);
  const base = `/v1/workspaces/${workspace.id}`;
  if (path === `${base}/session-agent-names`)
    return reply({ names: [...new Set(rows.map(({ row }) => row.agentName))] });
  if (path === `${base}/sessions/members`) return reply({ members });
  if (path === `${base}/sessions`) {
    let filtered = rows.map(({ row }) => row);
    for (const key of [
      "q",
      "project",
      "source",
      "agent",
      "since",
      "until",
    ] as const) {
      const value = query.get(key);
      if (!value) continue;
      filtered = filtered.filter((row) =>
        key === "q"
          ? JSON.stringify([
              row.title,
              row.project.name,
              row.agentName,
              row.shortSummary,
            ])
              .toLowerCase()
              .includes(value.toLowerCase().replace(/^@/, ""))
          : key === "project"
            ? row.projectId === value
            : key === "source"
              ? row.source === value
              : key === "agent"
                ? row.agentName === value
                : key === "since"
                  ? row.lastTs >= value
                  : row.firstTs <= value,
      );
    }
    const offset = Number(query.get("cursor") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      return reply({ error: "invalid_cursor" }, 400);
    return reply({
      items: filtered.slice(offset, offset + 12),
      members,
      nextCursor: offset + 12 < filtered.length ? String(offset + 12) : null,
      error: false,
      now: fixtureClock,
    });
  }
  if (path === `${base}/sessions/activity`) {
    const first = query.get("first") ?? "";
    const last = query.get("last") ?? "9999";
    return reply({
      days: usage(scenario, 90)
        .usage.days.filter((day) => day.date >= first && day.date <= last)
        .map((day) => ({
          date: day.date,
          conversations: day.sessionsUploaded,
          bySource: Object.fromEntries(
            ["codex", "claude"].map((source) => [
              source,
              rows.filter(
                ({ row }) =>
                  row.source === source && row.lastTs.startsWith(day.date),
              ).length,
            ]),
          ),
        })),
    });
  }
  if (path === `${base}/sessions/output`) return reply({ output: null });
  const sessionPath = new RegExp(
    `^${base}/sessions/([^/]+)/(events|turns|timing|catalog|summary)$`,
  ).exec(path);
  if (sessionPath) {
    const record = rows.find(
      ({ row }) =>
        row.sessionId === sessionPath[1] && row.source === query.get("source"),
    );
    if (!record) return reply({ error: "not_found" }, 404);
    switch (sessionPath[2]) {
      case "events":
        return reply({
          events: record.events,
          members,
          nextCursor: null,
          error: false,
        });
      case "turns":
        return reply({ turns: [], nextCursor: null });
      case "summary":
        return reply({ summary: record.summary });
      case "timing":
        return reply({
          timing:
            scenario === "partial"
              ? null
              : {
                  startedAt: record.row.firstTs,
                  lastActionAt: record.row.lastTs,
                  workMs: 2_400_000,
                  waitingMs: 1_200_000,
                },
        });
      case "catalog":
        return reply({
          catalog: record.row.catalog,
          parents: [],
          children: [],
          commitLinks: [],
          truncated: false,
        });
    }
  }
  const orgBase = `/v1/organizations/${organization.id}`;
  const days = Number(query.get("days") ?? 30);
  if (![7, 30, 90].includes(days))
    return reply({ error: "invalid_range" }, 400);
  if (path === `${orgBase}/usage`) return reply(usage(scenario, days));
  if (path === `${orgBase}/usage/people`) return reply(people(scenario, days));
  const person = new RegExp(`^${orgBase}/usage/people/([^/]+)/sessions$`).exec(
    path,
  );
  if (person) {
    const body = personSessions(scenario, person[1]!, days);
    return body ? reply(body) : reply({ error: "user_not_found" }, 404);
  }
  if (path === `${orgBase}/workspaces`)
    return reply({ workspaces: [workspace] });
  return missing();
}

function pause(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createFixtureFetch(
  scenario: ScenarioId,
  origin: string,
): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const requested = new URL(request?.url ?? String(input), origin);
    // Normalize only this exact preview origin. Absolute external URLs stay blocked.
    const url =
      requested.origin === origin
        ? new URL(
            `${requested.pathname}${requested.search}`,
            "http://design.test",
          )
        : requested;
    const result = fixtureReply(
      url,
      init?.method ?? request?.method ?? "GET",
      scenario,
    );
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) throw signal.reason;
    if (result.delay) await pause(result.delay, signal);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Design-Fixture": scenario,
      },
    });
  };
}
