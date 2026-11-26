// How much the v2 pages show, picked by the switch at the bottom centre (?data=none|few|many):
//   few  – the scenario as it is (three tasks)
//   none – nothing in flight, to design the empty states
//   many – about fifty tasks with a larger team, to design for a real company's scale
// "many" is built from the scenario's own sessions – each task gets copies of them with its own people,
// tokens, health, 10–20 models and sometimes a blocker or an overlap – deterministically, so every load
// looks the same. Tasks and overlaps keep the ids they have in "few", so a detail page stays put when the
// switch changes.
import { fixtureClock } from "../scenarios";
import type { Initiative, Overview, Person, SessionItem } from "../operator/model";
import type { Overlap } from "../operator/overlaps";
import { MODEL_CATALOGUE, setModel, type Model } from "./cost";

export type Density = "none" | "few" | "many";
const KEY = "agent-relay.workbench.data";

export function densityFrom(): Density {
  const fromUrl = new URLSearchParams(location.search).get("data");
  if (fromUrl === "none" || fromUrl === "few" || fromUrl === "many") {
    try {
      localStorage.setItem(KEY, fromUrl);
    } catch {
      // Storage blocked – the link still decides for this visit
    }
    return fromUrl;
  }
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "none" || kept === "few" || kept === "many") return kept;
  } catch {
    // Storage blocked
  }
  return "few";
}

/** A small, stable pseudo-random number in [0, 1) */
const seeded = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};
const pick = <T,>(list: readonly T[], n: number) => list[Math.floor(seeded(n) * list.length)]!;

const TASKS = [
  "Edge migration", "Billing integration", "Developer experience", "Postgres 16 upgrade", "SSO for enterprise", "Mobile push notifications",
  "Search relevance tuning", "Audit log export", "Rate limiting v2", "Onboarding checklist", "Usage-based pricing", "Webhook retries",
  "Dark mode", "Terraform modules cleanup", "Flaky test triage", "API pagination", "Invoice PDF redesign", "Feature flag service",
  "Session replay", "Kubernetes autoscaling", "GDPR data deletion", "Slack integration", "Docs site migration", "Error budget alerts",
  "CI build caching", "Image CDN", "Permissions model", "Email templates", "Background job queue", "Analytics pipeline",
  "React 19 upgrade", "Load testing", "Customer health score", "SOC 2 evidence", "Multi-region failover", "Changelog automation",
  "Billing dunning", "In-app search", "Data warehouse sync", "Accessibility pass", "Offline mode", "Partner API",
  "Trial-to-paid flow", "Secrets rotation", "Cost dashboards", "Incident runbooks", "Localization", "Workspace templates",
  "GraphQL gateway", "Status page",
] as const;
const PEOPLE: Person[] = [
  "Ana Silva", "Leo Martin", "Maya Chen", "Jonas Weber", "Priya Nair", "Tom Baker", "Sara Kim", "Diego Ruiz",
  "Emma Fischer", "Kofi Mensah", "Lena Novak", "Omar Haddad", "Julia Rossi", "Noah Clark", "Aiko Tanaka", "Felix Braun",
].map((name) => ({ id: `p-${name.toLowerCase().replace(/\s+/g, "-")}`, name }));
const BLOCKERS = [
  "Waiting on a staging hostname so the cache check can run.",
  "Needs a decision on the retry policy before rollout.",
  "Blocked on access to the production read replica.",
  "Waiting for the security review of the new scopes.",
  "Two sessions changed the same migration – needs a merge decision.",
  "The vendor sandbox is down; tests can't run.",
];
const NEXT = [
  "Validate in staging, then roll out to 10% of traffic.",
  "Review the open PR and merge behind a flag.",
  "Write the migration guide and notify the affected teams.",
  "Run the load test against the new limits.",
  "Pair on the failing edge case, then ship.",
];
const UPDATES = [
  "Core changes merged; rollout pending.",
  "Implementation done, review in progress.",
  "Spec agreed, first sessions exploring the codebase.",
  "Most of the work finished; cleanup and docs left.",
  "Prototype works locally; hardening for production.",
];

/** Which harness a model runs in – Claude models in Claude Code, OpenAI's in Codex, open models in OpenCode */
const HARNESS_FOR: Record<string, string> = { claude: "claude", chatgpt: "codex", gemini: "gemini", grok: "opencode", opencode: "opencode", cursor: "cursor" };

/** The scenario session each "many" copy was made from – the product's session page only knows those */
const ORIGIN = new Map<string, { id: string; source: string }>();

/**
 * Where "Open session" goes: Agent Relay's own session page – summary, details and the full transcript
 * with every prompt and tool call (`/dashboard/sessions/<id>?source=<harness>` in the product). In the
 * workbench that page is served, on the same scenario data, by the product preview at /preview/<scenario>/.
 */
export function sessionHref(s: SessionItem) {
  const origin = ORIGIN.get(s.id) ?? { id: s.id, source: s.source };
  const scenario = /^\/(?:operator|dashboard)\/([a-z-]+)\//.exec(location.pathname)?.[1] ?? "busy";
  return `/preview/${scenario}/?${new URLSearchParams({ session: origin.id, source: origin.source })}`;
}

function many(data: Overview): Overview {
  const base = data.initiatives.length ? data.initiatives : [];
  if (!base.length) return data;
  const now = Date.parse(fixtureClock);
  const span = data.period.days * 24 * 3_600_000;
  const initiatives: Initiative[] = TASKS.map((name, i) => {
    const src = base[i % base.length]!;
    const team = [pick(PEOPLE, i * 3 + 1), pick(PEOPLE, i * 3 + 2), ...(seeded(i * 7) > 0.6 ? [pick(PEOPLE, i * 3 + 3)] : [])].filter(
      (p, k, all) => all.findIndex((q) => q.id === p.id) === k,
    );
    // 10–20 models per task, picked from the catalogue in a stable shuffled order
    const models: Model[] = [...MODEL_CATALOGUE]
      .map((m, k) => ({ m, r: seeded(i * 97 + k * 13) }))
      .sort((x, y) => x.r - y.r)
      .slice(0, 10 + Math.floor(seeded(i * 53) * 11))
      .map((x) => x.m);
    const scale = 0.25 + seeded(i * 11) * 2.5;
    // Most tasks are worked on every day, up to now; about a quarter stalled a while ago. The tasks that
    // keep their "few" ids are always active, so their pages show a full period.
    const stalled = i >= base.length && seeded(i * 13) < 0.25;
    const shift = stalled ? Math.floor((0.2 + seeded(i * 17) * 0.4) * span) : Math.floor(seeded(i * 17) * 6 * 3_600_000);
    // Enough sessions for at least one or two a day across the period
    const perDay = 1.2 + seeded(i * 19) * 5;
    const count = Math.min(160, Math.max(8, Math.round(perDay * data.period.days)));
    const step = Math.max(20 * 60_000, (span - shift) / count);
    const sessions: SessionItem[] = Array.from({ length: count }, (_, k) => {
      const s = src.sessions[k % src.sessions.length]!;
      const person = team[k % team.length]!;
      const model = models[Math.floor(seeded(i * 211 + k * 7) * models.length)]!;
      // Evenly through the active stretch, each a little earlier or later than its slot
      const last = now - shift - Math.floor((k + seeded(i * 31 + k) * 0.8) * step);
      const first = last - (60 + Math.floor(seeded(i + k * 3) * 300)) * 60_000;
      const id = `${s.id}-m${i}-${k}`;
      setModel(id, model);
      ORIGIN.set(id, { id: s.id, source: s.source });
      // Only a task's newest session can still be running, and only if it moved in the last hour
      // Older sessions mostly ended – a good share of them with their work shipped
      const status =
        k === 0 && shift < 3_600_000 && s.status === "active"
          ? "active"
          : k >= 2 && seeded(i * 43 + k * 5) < 0.5
            ? "finished"
            : s.status === "active"
              ? "idle"
              : s.status;
      return {
        ...s,
        id,
        person,
        source: HARNESS_FOR[model.icon] ?? s.source,
        status,
        tokens: s.tokens === null ? null : Math.round(s.tokens * scale * (0.5 + seeded(i * 5 + k))),
        firstTs: new Date(first).toISOString(),
        lastTs: new Date(last).toISOString(),
      };
    });
    const atRisk = seeded(i * 23) < 0.18;
    const lastTs = sessions.map((s) => s.lastTs).sort().at(-1) ?? null;
    return {
      ...src,
      // The first tasks keep the scenario's ids, so their pages exist in every mode
      id: i < base.length ? src.id : `task-${i + 1}`,
      name,
      goal: i < base.length ? src.goal : src.goal ? `${name}: ${src.goal.charAt(0).toLowerCase()}${src.goal.slice(1)}` : null,
      health: atRisk ? "at-risk" : "on-track",
      tone: atRisk ? "blocked" : src.tone,
      blocker: i < base.length ? src.blocker : atRisk ? pick(BLOCKERS, i * 29) : null,
      update: i < base.length ? src.update : pick(UPDATES, i * 31),
      progress: i < base.length ? src.progress : pick(UPDATES, i * 31).replace(/\.$/, ""),
      nextStep: i < base.length ? src.nextStep : pick(NEXT, i * 37),
      sessions,
      people: team,
      tokens: sessions.reduce((a, s) => a + (s.tokens ?? 0), 0),
      tokenSessions: sessions.filter((s) => s.tokens !== null).length,
      lastTs,
    };
  });
  // About a quarter of the tasks run into other work – the scenario's overlaps first (same ids), then copies
  const overlaps: Overlap[] = data.overlaps.length
    ? initiatives
        .filter((_, i) => i < data.overlaps.length || seeded(i * 41) < 0.26)
        .map((t, k) => {
          const o = data.overlaps[k % data.overlaps.length]!;
          const sides = [t.sessions[0]!, t.sessions[1] ?? t.sessions[0]!] as [SessionItem, SessionItem];
          return {
            ...o,
            id: k < data.overlaps.length ? o.id : `${o.id}-m${k}`,
            initiative: k < data.overlaps.length ? o.initiative : t.name,
            sides: k < data.overlaps.length ? o.sides : sides,
            evidence: k < data.overlaps.length ? o.evidence : o.evidence.map((e, j) => ({ ...e, sessionId: sides[j % 2]!.id })),
            detectedAt: k < data.overlaps.length ? o.detectedAt : sides[0].lastTs,
          };
        })
    : [];
  return { ...data, initiatives, overlaps, sessions: initiatives.reduce((a, t) => a + t.sessions.length, 0), people: PEOPLE.length };
}

/**
 * "None" on a task's page: the task itself, with nothing recorded for it yet – so the page's empty states
 * can be designed. (On the lists, "none" simply means nothing in flight.)
 */
export function emptyTask(data: Overview, id: string): Overview {
  return {
    ...data,
    initiatives: data.initiatives
      .filter((i) => i.id === id)
      .map((i) => ({ ...i, sessions: [], people: [], tokens: null, tokenSessions: 0, lastTs: null, blocker: null, health: "on-track", progress: "Nothing recorded for this task yet", update: "Nothing recorded for this task yet" })),
    overlaps: [],
    improvements: [],
    stuck: [],
  };
}

/**
 * "A few": the scenario runs Claude Code on Sonnet only. To show a task that mixes models, its Claude Code
 * sessions take turns between Sonnet, Opus and Haiku – so a task shows four models instead of two.
 */
function fewModels(data: Overview): Overview {
  const claude = ["Claude Sonnet", "Claude Opus", "Claude Haiku"].map((n) => MODEL_CATALOGUE.find((m) => m.name === n)!);
  for (const task of data.initiatives)
    task.sessions.filter((s) => s.source === "claude").forEach((s, k) => setModel(s.id, claude[k % claude.length]!));
  // The scenario's sessions last exactly one hour each, one after the other. Real ones run from under an
  // hour to half a day and overlap – so each starts 1–6 hours before it last moved.
  return {
    ...data,
    initiatives: data.initiatives.map((t, i) => ({
      ...t,
      sessions: t.sessions.map((s, k) => ({ ...s, firstTs: new Date(Date.parse(s.lastTs) - (60 + Math.floor(seeded(i * 101 + k * 17) * 300)) * 60_000).toISOString() })),
    })),
  };
}

export function withDensity(data: Overview, density: Density): Overview {
  if (density === "none")
    return { ...data, initiatives: [], projects: [], overlaps: [], stuck: [], improvements: [], sessions: 0 };
  if (density === "many") return many(data);
  return fewModels(data);
}
