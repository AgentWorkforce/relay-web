// The operator overview, as one plain object: built from the workbench's fixtures (dataset, the
// proposed initiatives and the proposed analysis pack in operator-data.ts). Nothing here calls a
// model or an API. Proposed fields stay marked as proposed, missing data stays missing (null).
import { operatorData } from "../operator-data";
import { overlapsFor, type Overlap } from "./overlaps";
import { dataset, fixtureClock, people as usagePeople, proposedInitiatives, seed, usage, type ScenarioId } from "../scenarios";

/** The periods the page can show; the panel's heading uses `title`, the picker `label` */
export const PERIODS = [
  { id: "24h", days: 1, label: "Last 24 hours", title: "Today" },
  { id: "7d", days: 7, label: "Last 7 days", title: "This week" },
  { id: "30d", days: 30, label: "Last 30 days", title: "This month" },
] as const;
export type Period = (typeof PERIODS)[number];
export const periodFrom = (id: string | null | undefined): Period => PERIODS.find((p) => p.id === id) ?? PERIODS[1];

export type Tone = "blocked" | "review" | "progress";
export type Person = { id: string; name: string };

export type SessionItem = {
  id: string;
  title: string;
  agent: string;
  source: string;
  person: Person | null;
  machine: string | null;
  status: string;
  summary: string | null;
  prompt: string;
  result: string;
  tokens: number | null;
  /** When the session started (first recorded event) */
  firstTs: string;
  lastTs: string;
  workType: string | null;
};

export type Initiative = {
  id: string;
  name: string;
  /** What the people asked for, in one sentence (proposed synthesis) */
  goal: string | null;
  tone: Tone;
  status: string;
  /** Health in the Linear sense: is it moving as expected? */
  health: "on-track" | "at-risk";
  /** A written status update – the summary of its sessions' summaries (proposed synthesis) */
  update: string;
  progress: string;
  /** What holds it up, if anything – a fact about the work, not a to-do for the operator */
  blocker: string | null;
  nextStep: string;
  sessions: SessionItem[];
  people: Person[];
  tokens: number | null;
  tokenSessions: number;
  lastTs: string | null;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  sessions: number;
  searches: number;
  lastActiveAt: string | null;
  topProjects: { name: string; sessions: number }[];
};

export type Analysis = "current" | "stale" | "unavailable" | "empty";

export type Overview = {
  period: Period;
  /** Where two agents' work touches the same thing (proposed, see overlaps.ts) */
  overlaps: Overlap[];
  org: string;
  workspace: string;
  analysis: Analysis;
  sessions: number;
  people: number;
  initiatives: Initiative[];
  /** Sessions grouped by project when no current initiative analysis exists */
  projects: { name: string; sessions: SessionItem[]; tokens: number | null }[];
  budget: {
    tokens: number | null;
    tokenSessions: number;
    cost: number | null;
    models: { name: string; sessions: number }[];
    workTypes: { name: string; sessions: number }[];
    uncategorized: number;
    byPerson: { name: string; tokens: number }[];
    byModel: { name: string; tokens: number }[];
  };
  stuck: { id: string; text: string; initiative: string | null; sessions: string[] }[];
  /** How the team uses Relay itself – the same numbers as today's Settings → Usage page */
  team: {
    searches: number;
    /** null when the workspace doesn't report summaries */
    summaries: number | null;
    members: TeamMember[];
  };
  improvements: {
    id: string;
    observation: string;
    suggestion: string;
    measure: string;
    sessions: string[];
  }[];
};

const tone = (status: string, decision: string | null): Tone =>
  decision ? "blocked" : /review/i.test(status) ? "review" : "progress";
const statusLabel = (t: Tone, status: string) =>
  t === "blocked" ? "Blocked" : t === "review" ? "Ready for review" : status;
const sum = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

/**
 * A session reported as running that has been quiet for over an hour counts as idle: the agent is
 * most likely waiting or was left open, and "running now" should mean work that is moving right now.
 */
const QUIET_MS = 60 * 60 * 1000;
const settled = (status: string, lastTs: string) =>
  status === "active" && Date.parse(fixtureClock) - Date.parse(lastTs) > QUIET_MS ? "idle" : status;

export function overview(scenario: ScenarioId, period: Period = PERIODS[1]): Overview {
  // Only work that was active within the period
  const since = Date.parse(fixtureClock) - period.days * 86_400_000;
  const records = dataset(scenario).filter(({ row }) => Date.parse(row.lastTs) >= since);
  const full = operatorData(scenario);
  const inPeriod = new Set(records.map(({ row }) => row.sessionId));
  const pack = {
    ...full,
    sessions: full.sessions.filter((x) => inPeriod.has(x.sessionId)),
    statistics: {
      ...full.statistics,
      people: new Set(records.flatMap(({ row }) => row.userIds)).size,
      categories: full.statistics.categories.map((c) => ({ ...c, sessionIds: c.sessionIds.filter((id) => inPeriod.has(id)) })),
    },
    coverage: { ...full.coverage, tokenSessions: records.filter(({ row }) => row.totalInputTokens !== null).length },
    improvementOpportunities: full.improvementOpportunities
      .map((i) => ({ ...i, sessionIds: i.sessionIds.filter((id) => inPeriod.has(id)) }))
      .filter((i) => i.sessionIds.length > 0),
  };
  const analysis: Analysis =
    records.length === 0
      ? "empty"
      : pack.coverage.currentAnalysisSessions > 0
        ? "current"
        : pack.coverage.staleAnalysisSessions > 0
          ? "stale"
          : "unavailable";

  const sessions: SessionItem[] = records.map(({ row, summary, events }) => {
    const person = seed.people.find((p) => row.userIds.includes(p.id));
    const analysed = pack.sessions.find((s) => s.sessionId === row.sessionId);
    return {
      id: row.sessionId,
      title: row.title,
      agent: row.agentName,
      source: row.source,
      person: person ? { id: person.id, name: person.name } : null,
      machine: seed.machines.find((m) => row.machineIds.includes(m.id))?.name ?? null,
      status: settled(row.workState.status, row.lastTs),
      summary: summary.status === "ready" ? summary.summary : null,
      prompt: events[0]!.content,
      result: events[3]!.content,
      tokens:
        row.totalInputTokens === null || row.totalOutputTokens === null
          ? null
          : row.totalInputTokens + row.totalOutputTokens,
      firstTs: row.firstTs,
      lastTs: row.lastTs,
      workType:
        analysed?.analysisStatus === "current" ? (analysed.understanding?.sessionType.value ?? null) : null,
    };
  });
  const byProject = (name: string) => {
    const project = records
      .filter(({ row }) => row.project.name === name)
      .map(({ row }) => row.sessionId);
    return sessions.filter((s) => project.includes(s.id));
  };

  const initiatives: Initiative[] =
    analysis === "current"
      ? proposedInitiatives
          .map((item, index) => {
            const list = byProject(item.name);
            const t = tone(item.status, item.decision);
            const people = [...new Map(list.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()];
            return {
              id: `initiative-${index + 1}`,
              name: item.name,
              goal: pack.initiatives.find((i) => i.title === item.name)?.humanGoal ?? null,
              tone: t,
              status: statusLabel(t, item.status),
              health: t === "blocked" ? ("at-risk" as const) : ("on-track" as const),
              // What matters most first: what holds it up, then where it stands, then what comes next
              update: [
                item.decision ? `Waiting on someone to ${item.decision.charAt(0).toLowerCase()}${item.decision.slice(1)}` : null,
                `${item.progress.charAt(0).toUpperCase()}${item.progress.slice(1)}.`,
                `Next: ${item.nextStep.charAt(0).toLowerCase()}${item.nextStep.slice(1)}`,
              ]
                .filter(Boolean)
                .join(" "),
              progress: item.progress,
              blocker: item.decision,
              nextStep: item.nextStep,
              sessions: list,
              people,
              tokens: sum(list.map((s) => s.tokens)),
              tokenSessions: list.filter((s) => s.tokens !== null).length,
              lastTs: list.map((s) => s.lastTs).sort().at(-1) ?? null,
            };
          })
          .filter((i) => i.sessions.length > 0)
      : [];

  const projectNames = [...new Set(records.map(({ row }) => row.project.name))];
  const projects = projectNames.map((name) => {
    const list = byProject(name);
    return { name, sessions: list, tokens: sum(list.map((s) => s.tokens)) };
  });

  const models = new Map<string, number>();
  for (const { row } of records) for (const m of row.models) models.set(m, (models.get(m) ?? 0) + 1);

  const projectOf = (sessionId: string) =>
    records.find(({ row }) => row.sessionId === sessionId)?.row.project.name ?? null;
  const stuck = pack.sessions.flatMap((s) =>
    (s.understanding?.blockers ?? []).map((b, i) => ({
      id: `${s.sessionId}-blocker-${i}`,
      text: b.text,
      initiative: projectOf(s.sessionId),
      sessions: [s.sessionId],
    })),
  );
  // The same blocker reported in several sessions is one item with several sessions behind it
  const merged = new Map<string, (typeof stuck)[number]>();
  for (const item of stuck) {
    const key = `${item.initiative}|${item.text}`;
    const found = merged.get(key);
    if (found) found.sessions.push(...item.sessions);
    else merged.set(key, { ...item, sessions: [...item.sessions] });
  }

  const projectOfSession = (id: string) => records.find(({ row }) => row.sessionId === id)?.row.project.name ?? null;
  return {
    period,
    overlaps: analysis === "empty" ? [] : overlapsFor(sessions, projectOfSession),
    org: seed.organization.name,
    workspace: seed.workspace.name,
    analysis,
    sessions: records.length,
    people: pack.statistics.people,
    initiatives,
    projects,
    budget: {
      tokens: sum(sessions.map((s) => s.tokens)),
      tokenSessions: pack.coverage.tokenSessions,
      cost: pack.statistics.costUSD,
      models: [...models].map(([name, n]) => ({ name, sessions: n })),
      workTypes: pack.statistics.categories
        .map((c) => ({ name: c.value, sessions: c.sessionIds.length }))
        .filter((c) => c.sessions > 0)
        .sort((a, b) => b.sessions - a.sessions),
      uncategorized: pack.statistics.uncategorizedSessions,
      byPerson: split(sessions.map((s) => [s.person?.name ?? "Unknown", s.tokens])),
      byModel: split(records.map(({ row }, i) => [row.models[0] ?? "Unknown", sessions[i]!.tokens])),
    },
    stuck: [...merged.values()],
    team: (() => {
      const u = usage(scenario, period.days).usage;
      return {
        searches: u.totals.searches,
        summaries: u.totals.summaries ?? null,
        members: usagePeople(scenario, period.days).people.members.map((m) => ({
          id: m.userId,
          name: m.name ?? "Unknown",
          email: m.email ?? "",
          role: m.role,
          sessions: m.sessionsUploaded ?? 0,
          searches: m.searches ?? 0,
          lastActiveAt: m.lastActiveAt ?? null,
          topProjects: m.topProjects,
        })),
      };
    })(),
    improvements: pack.improvementOpportunities.map((item) => ({
      id: item.id,
      observation: item.observation,
      suggestion: item.recommendation,
      measure: item.suggestedMeasure,
      sessions: item.sessionIds,
    })),
  };
}

/** Known token counts summed per key, largest first */
function split(pairs: [string, number | null][]) {
  const totals = new Map<string, number>();
  for (const [key, n] of pairs) if (n !== null) totals.set(key, (totals.get(key) ?? 0) + n);
  return [...totals].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens);
}

export const formatTokens = (n: number | null) =>
  n === null ? "–" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export function ago(ts: string | null, now: string) {
  if (!ts) return "–";
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(ts)) / 60_000));
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
