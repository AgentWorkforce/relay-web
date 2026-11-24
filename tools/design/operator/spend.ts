// Spend: where the tokens go, and what came out of them. Built only from what sessions record today
// (token counts, person, harness, model, status) plus the overlaps' "spent twice" estimate. Dollar
// cost isn't reported yet – the page says so instead of guessing a price.
import type { Overview, SessionItem } from "./model";

export type SpendRow = {
  id: string;
  name: string;
  tokens: number;
  sessions: number;
  /** Sessions that finished – the closest thing to "it produced something" the data has today */
  finished: number;
  /** Tokens per finished session – null when nothing finished */
  perFinished: number | null;
  share: number;
};
export type Outcome = { id: "finished" | "working" | "paused" | "twice"; label: string; tokens: number };

export type Spend = {
  total: number;
  tokenSessions: number;
  sessions: number;
  byInitiative: SpendRow[];
  byPerson: SpendRow[];
  byHarness: SpendRow[];
  byModel: SpendRow[];
  outcomes: Outcome[];
  /** The biggest single sessions – where one run used a lot */
  biggest: SessionItem[];
};

export const HARNESS_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", opencode: "OpenCode" };

function rows(groups: { id: string; name: string; sessions: SessionItem[] }[], total: number): SpendRow[] {
  return groups
    .map((g) => {
      const tokens = g.sessions.reduce((a, s) => a + (s.tokens ?? 0), 0);
      const finished = g.sessions.filter((s) => s.status === "finished");
      const finishedTokens = finished.reduce((a, s) => a + (s.tokens ?? 0), 0);
      return {
        id: g.id,
        name: g.name,
        tokens,
        sessions: g.sessions.length,
        finished: finished.length,
        perFinished: finished.length ? Math.round(finishedTokens / finished.length) : null,
        share: total ? tokens / total : 0,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

const groupBy = (sessions: SessionItem[], key: (s: SessionItem) => string, name: (k: string) => string = (k) => k) => {
  const m = new Map<string, SessionItem[]>();
  for (const s of sessions) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
  return [...m].map(([k, list]) => ({ id: k, name: name(k), sessions: list }));
};

export function spendOf(data: Overview, modelOf: (sessionId: string) => string = () => "synthetic-model"): Spend {
  const groups = data.initiatives.length
    ? data.initiatives.map((i) => ({ id: i.id, name: i.name, sessions: i.sessions }))
    : data.projects.map((p) => ({ id: p.name, name: p.name, sessions: p.sessions }));
  const sessions = groups.flatMap((g) => g.sessions);
  const total = sessions.reduce((a, s) => a + (s.tokens ?? 0), 0);
  const twice = data.overlaps.reduce((a, o) => a + (o.duplicateTokens ?? 0), 0);
  const sum = (status: string) => sessions.filter((s) => s.status === status).reduce((a, s) => a + (s.tokens ?? 0), 0);
  return {
    total,
    tokenSessions: sessions.filter((s) => s.tokens !== null).length,
    sessions: sessions.length,
    byInitiative: rows(groups, total),
    byPerson: rows(groupBy(sessions, (s) => s.person?.name ?? "Unknown"), total),
    byHarness: rows(groupBy(sessions, (s) => s.source, (k) => HARNESS_NAMES[k] ?? k), total),
    byModel: rows(groupBy(sessions, (s) => modelOf(s.id)), total),
    // What the tokens bought: finished work, work still running, paused work – and the part spent twice
    // (already inside the other three; shown separately because it's the part that bought nothing new)
    outcomes: [
      { id: "finished", label: "Finished work", tokens: sum("finished") },
      { id: "working", label: "Still running", tokens: sum("active") },
      { id: "paused", label: "Paused, no result yet", tokens: sessions.filter((s) => s.status !== "finished" && s.status !== "active").reduce((a, s) => a + (s.tokens ?? 0), 0) },
      { id: "twice", label: "Spent twice", tokens: twice },
    ],
    biggest: [...sessions].filter((s) => s.tokens !== null).sort((a, b) => b.tokens! - a.tokens!).slice(0, 5),
  };
}
