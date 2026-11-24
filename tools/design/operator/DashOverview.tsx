// Dashboard → Overview: the team dashboard's landing page. How the team works with agents and Relay
// right now, in three calm rows – key figures; activity over the period next to what runs now; who,
// which harness and which machine the work came from. Everything hands off to the deeper views:
// a person opens in the panel, a session opens in the panel, "All sessions" goes to Sessions.
//
// It shows activity and adoption, not outcomes – what the work achieves (initiatives, blockers, spend)
// is the Operator view's job.
//
// The fixtures only cover the last ~30 hours. So the 7 and 30 day charts have days with real data
// and, before them, sample history derived from it – drawn lighter and labelled as such.
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, CircleDot, Laptop, MessagesSquare, Search, Sparkles, Users } from "lucide-react";
import { fixtureClock, type ScenarioId } from "../scenarios";
import { HomeShell } from "./HomeShell";
import { ago, formatTokens, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";
import { openPage } from "./pages";
import { HARNESS_LABELS, HarnessLogo, Initials } from "./WeekPanel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HARNESS_COLORS: Record<string, string> = {
  claude: "#d97757",
  codex: "#5b8def",
  cursor: "#8b8f98",
  opencode: "#9a83d9",
  gemini: "#2fae94",
};
const colorOf = (source: string) => HARNESS_COLORS[source] ?? "#8b8f98";
const harnessName = (source: string) => HARNESS_LABELS[source] ?? source;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A small, stable pseudo-random number in [0, 1) – the sample history looks the same on every load */
const seeded = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

const sessionsOf = (data: Overview) => (data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions));

type Metric = "sessions" | "tokens";
type Bucket = { start: number; end: number; label: string; tip: string; sample: boolean; bySource: Record<string, { sessions: number; tokens: number }> };

/** The period cut into hours (24h) or days (7d, 30d); days before the data starts get sample history */
function bucketsOf(data: Overview, sessions: SessionItem[]): Bucket[] {
  const now = Date.parse(fixtureClock);
  const hourly = data.period.days === 1;
  const step = hourly ? HOUR : DAY;
  const count = hourly ? 24 : data.period.days;
  // Days end at midnight (UTC, like the fixtures' dates); the last one is today
  const lastEnd = hourly ? now : Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) + DAY;
  const earliest = Math.min(...sessions.map((s) => Date.parse(s.firstTs)), now);
  const sources = [...new Set(sessions.map((s) => s.source))];
  const share = (src: string) => sessions.filter((s) => s.source === src).length / Math.max(1, sessions.length);
  // Sessions per calendar day the data touches – so sample days sit at the real days' level
  const perDay = sessions.length / Math.max(1, Math.ceil((now - earliest) / DAY));
  const tokensPer = sessions.reduce((a, s) => a + (s.tokens ?? 0), 0) / Math.max(1, sessions.filter((s) => s.tokens !== null).length);

  return Array.from({ length: count }, (_, i) => {
    const end = lastEnd - (count - 1 - i) * step;
    const start = end - step;
    const d = new Date(start);
    const label = hourly
      ? `${String(d.getHours()).padStart(2, "0")}:00`
      : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
    const tip = hourly
      ? d.toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    const bySource: Bucket["bySource"] = {};
    const sample = !hourly && end <= earliest;
    if (sample) {
      // Sample history: about the observed daily volume, quieter on weekends, split like the real mix
      const weekend = [0, 6].includes(d.getUTCDay());
      const total = Math.round(perDay * (weekend ? 0.3 : 0.75 + seeded(i) * 0.5));
      for (const src of sources) {
        const n = Math.round(total * share(src));
        bySource[src] = { sessions: n, tokens: Math.round(n * tokensPer * (0.8 + seeded(i + 7) * 0.4)) };
      }
    } else {
      for (const s of sessions) {
        const t = Date.parse(s.lastTs);
        if (t < start || t >= end) continue;
        const b = (bySource[s.source] ??= { sessions: 0, tokens: 0 });
        b.sessions += 1;
        b.tokens += s.tokens ?? 0;
      }
    }
    return { start, end, label, tip, sample, bySource };
  });
}

/** A round axis maximum: 1, 2 or 5 times a power of ten */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

function Kpis({ data, sessions }: { data: Overview; sessions: SessionItem[] }) {
  const running = sessions.filter((s) => s.status === "active").length;
  const people = new Set(sessions.flatMap((s) => (s.person ? [s.person.id] : []))).size;
  const prevWord = data.period.days === 1 ? "yesterday" : data.period.days === 7 ? "last week" : "last month";
  // How it compares with the period before (sample: the fixtures have no earlier period)
  const delta = (cur: number, seed: number) => {
    const prev = Math.max(1, Math.round(cur * (0.7 + seeded(seed) * 0.5)));
    const pct = Math.round(((cur - prev) / prev) * 100);
    return `${pct >= 0 ? "+" : ""}${pct}% vs ${prevWord}`;
  };
  const items: { label: string; value: string; note: string; icon: ReactNode }[] = [
    { label: "Active people", value: String(people), note: `of ${data.team.members.length} in the workspace`, icon: <Users size={16} aria-hidden="true" /> },
    { label: "Sessions", value: String(sessions.length), note: delta(sessions.length, 1), icon: <MessagesSquare size={16} aria-hidden="true" /> },
    { label: "Running now", value: String(running), note: running ? `on ${plural(new Set(sessions.filter((s) => s.status === "active").map((s) => s.machine)).size, "machine")}` : "Nothing running", icon: <CircleDot size={16} aria-hidden="true" /> },
    { label: "Searches", value: String(data.team.searches), note: delta(data.team.searches, 2), icon: <Search size={16} aria-hidden="true" /> },
    {
      label: "Summaries",
      value: data.team.summaries === null ? "–" : String(data.team.summaries),
      note: data.team.summaries === null ? "Not reported" : `${sessions.filter((s) => s.summary).length} of ${sessions.length} sessions summarized`,
      icon: <Sparkles size={16} aria-hidden="true" />,
    },
  ];
  return (
    <section className="do-kpis" aria-label="Key figures">
      {items.map((k) => (
        <div key={k.label} className="sp-kpi">
          <span className="sp-kpi__head">
            <span>{k.label}</span>
            {k.icon}
          </span>
          <span className="sp-kpi__value">{k.value}</span>
          <span className="sp-kpi__note">{k.note}</span>
        </div>
      ))}
    </section>
  );
}

/** Sessions (or tokens) per hour or day, stacked by harness; hover a bar for its numbers */
function Activity({ data, sessions }: { data: Overview; sessions: SessionItem[] }) {
  const [metric, setMetric] = useState<Metric>("sessions");
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo(() => bucketsOf(data, sessions), [data, sessions]);
  const sources = [...new Set(sessions.map((s) => s.source))];
  const value = (b: Bucket, src?: string) =>
    src ? (b.bySource[src]?.[metric] ?? 0) : Object.values(b.bySource).reduce((a, x) => a + x[metric], 0);
  // Counts get an axis of at least 5, so one session an hour doesn't fill the chart; ticks stay whole numbers
  const max = niceMax(Math.max(metric === "sessions" ? 5 : 1, ...buckets.map((b) => value(b))));
  const ticks = metric === "sessions" && (max / 2) % 1 !== 0 ? [0, max] : [0, max / 2, max];
  const fmt = (n: number) => (metric === "tokens" ? formatTokens(n) : String(Math.round(n)));
  // Label every bar when they fit, else every few
  const every = buckets.length > 14 ? Math.ceil(buckets.length / 8) : buckets.length > 12 ? 2 : 1;
  const hasSample = buckets.some((b) => b.sample);
  const shown = hover !== null ? buckets[hover]! : null;

  return (
    <section className="do-card do-activity" aria-label="Activity">
      <div className="do-card__head">
        <h2 className="do-card__title">Activity</h2>
        <div className="o2-seg" role="tablist" aria-label="Show">
          {(["sessions", "tokens"] as const).map((m) => (
            <button key={m} type="button" role="tab" data-slot="o2-seg" aria-selected={metric === m} onClick={() => setMetric(m)}>
              {m === "sessions" ? "Sessions" : "Tokens"}
            </button>
          ))}
        </div>
      </div>
      <ul className="do-legend">
        {sources.map((src) => (
          <li key={src}>
            <span style={{ background: colorOf(src) }} /> {harnessName(src)}
          </li>
        ))}
      </ul>
      <div className="do-chart" onMouseLeave={() => setHover(null)}>
        <div className="do-chart__axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="do-chart__plot">
          {ticks.map((t) => (
            <span key={t} className="do-chart__grid" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden="true" />
          ))}
          <div className="do-chart__bars">
            {buckets.map((b, i) => (
              <div
                key={b.start}
                className="do-bar"
                data-sample={b.sample || undefined}
                data-hover={hover === i || undefined}
                onMouseEnter={() => setHover(i)}
                role="img"
                aria-label={`${b.tip}: ${fmt(value(b))} ${metric}`}
              >
                <div className="do-bar__stack" style={{ height: `${(value(b) / max) * 100}%` }}>
                  {sources.map((src) =>
                    value(b, src) ? <span key={src} style={{ flexGrow: value(b, src), background: colorOf(src) }} /> : null,
                  )}
                </div>
              </div>
            ))}
          </div>
          {shown && (
            // Beside the bar, centred on the chart's height: to its right, or to its left for bars in the right half
            <div
              className="do-tip"
              data-side={hover! < buckets.length / 2 ? "right" : "left"}
              style={{ left: `${((hover! < buckets.length / 2 ? hover! + 1 : hover!) / buckets.length) * 100}%` }}
            >
              <b>{shown.tip}</b>
              {sources.filter((src) => value(shown, src) > 0).map((src) => (
                <span key={src} className="do-tip__row">
                  <i style={{ background: colorOf(src) }} /> {harnessName(src)}
                  <span className="o2-num">{fmt(value(shown, src))}</span>
                </span>
              ))}
              {shown.sample && <span className="do-tip__note">Sample history</span>}
            </div>
          )}
        </div>
        <div className="do-chart__labels" aria-hidden="true">
          {buckets.map((b, i) => (
            <span key={b.start}>{i % every === every - 1 || i === buckets.length - 1 ? b.label : ""}</span>
          ))}
        </div>
      </div>
      {hasSample && <p className="do-note">Lighter bars are sample history – the fixtures only cover the last ~30 hours.</p>}
    </section>
  );
}

function RunningNow({ sessions, pick, onPick }: { sessions: SessionItem[]; pick: Pick | null; onPick: (p: Pick) => void }) {
  const running = sessions.filter((s) => s.status === "active").sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs));
  const latest = sessions.filter((s) => s.status !== "active").sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs)).slice(0, Math.max(0, 4 - running.length));
  const row = (s: SessionItem, live: boolean) => (
    <li key={s.id}>
      <button
        type="button"
        data-slot="do-row"
        className="do-row"
        aria-pressed={pick?.kind === "session" && pick.id === s.id}
        onClick={() => onPick({ kind: "session", id: s.id, from: null })}
      >
        <span className="do-dot" data-live={live || undefined} aria-hidden="true" />
        <span className="do-row__text">
          <span className="do-row__title">{s.title}</span>
          <span className="do-row__meta">
            <HarnessLogo source={s.source} /> {s.person?.name.split(" ")[0] ?? "Unknown"} · {s.machine ?? "Unknown machine"}
          </span>
        </span>
        <span className="do-row__time">{live ? `Started ${ago(s.firstTs, fixtureClock).toLowerCase()}` : ago(s.lastTs, fixtureClock)}</span>
      </button>
    </li>
  );
  return (
    <section className="do-card do-live" aria-label="Running now">
      <div className="do-card__head">
        <h2 className="do-card__title">
          Running now <span className="do-count">{running.length}</span>
        </h2>
      </div>
      <ul className="do-rows">
        {running.map((s) => row(s, true))}
        {running.length === 0 && <li className="do-empty">Nothing is running right now.</li>}
      </ul>
      {latest.length > 0 && (
        <>
          <h3 className="do-sub">Just finished or paused</h3>
          <ul className="do-rows">{latest.map((s) => row(s, false))}</ul>
        </>
      )}
      <button type="button" data-slot="do-link" className="do-link" onClick={() => openPage("sessions")}>
        All sessions <ArrowRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}

/** One bar per item – a person, harness or machine – sized by sessions */
function Bars({
  title,
  items,
  onItem,
  pickedId,
}: {
  title: string;
  items: { id: string; label: string; lead: ReactNode; sessions: number; note: string; color?: string }[];
  onItem?: (id: string) => void;
  pickedId?: string | null;
}) {
  const max = Math.max(1, ...items.map((i) => i.sessions));
  return (
    <section className="do-card" aria-label={title}>
      <div className="do-card__head">
        <h2 className="do-card__title">{title}</h2>
      </div>
      <ul className="do-bars">
        {items.map((i) => {
          const body = (
            <>
              <span className="do-bars__who">
                {i.lead}
                <span className="do-bars__label">{i.label}</span>
              </span>
              <span className="do-bars__track">
                <span style={{ width: `${(i.sessions / max) * 100}%`, background: i.color }} />
              </span>
              <span className="do-bars__n o2-num">{i.sessions}</span>
              <span className="do-bars__note">{i.note}</span>
            </>
          );
          return (
            <li key={i.id}>
              {onItem ? (
                <button type="button" data-slot="do-bars" className="do-bars__row" aria-pressed={pickedId === i.id} onClick={() => onItem(i.id)}>
                  {body}
                </button>
              ) : (
                <div className="do-bars__row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Page({ data, pick, onPick }: { data: Overview; pick: Pick | null; onPick: (p: Pick) => void }) {
  const sessions = useMemo(() => sessionsOf(data), [data]);
  const running = sessions.filter((s) => s.status === "active").length;
  const people = [...new Map(sessions.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()];
  const periodWord = data.period.days === 1 ? "today" : data.period.days === 7 ? "this week" : "this month";
  const byPerson = people
    .map((p) => {
      const mine = sessions.filter((s) => s.person?.id === p.id);
      return {
        id: p.id,
        label: p.name,
        lead: <Initials name={p.name} />,
        sessions: mine.length,
        note: `${formatTokens(mine.reduce((a, s) => a + (s.tokens ?? 0), 0))} tokens`,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
  const byHarness = [...new Set(sessions.map((s) => s.source))]
    .map((src) => {
      const mine = sessions.filter((s) => s.source === src);
      return { id: src, label: harnessName(src), lead: <HarnessLogo source={src} />, sessions: mine.length, note: plural(new Set(mine.map((s) => s.person?.id)).size, "person", "people"), color: colorOf(src) };
    })
    .sort((a, b) => b.sessions - a.sessions);
  const byMachine = [...new Set(sessions.map((s) => s.machine ?? "Unknown machine"))]
    .map((m) => {
      const mine = sessions.filter((s) => (s.machine ?? "Unknown machine") === m);
      const live = mine.some((s) => s.status === "active");
      return {
        id: m,
        label: m,
        lead: <Laptop size={14} aria-hidden="true" className="o-lead-icon" />,
        sessions: mine.length,
        note: live ? "Running now" : `Last active ${ago(mine.map((s) => s.lastTs).sort().at(-1) ?? null, fixtureClock).toLowerCase()}`,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  return (
    <>
      <section className="o2-hero do-hero" aria-label="Summary">
        <p className="o2-eyebrow">
          {data.org} · {data.workspace}
        </p>
        <h2 className="do-title">
          {running ? `${plural(running, "agent")} running now` : "No agents running right now"}
          <span className="do-title__rest">
            {" "}
            · {plural(sessions.length, "session")} {periodWord} · {plural(people.length, "person", "people")} active
          </span>
        </h2>
      </section>

      <Kpis data={data} sessions={sessions} />

      <div className="do-row2">
        <Activity data={data} sessions={sessions} />
        <RunningNow sessions={sessions} pick={pick} onPick={onPick} />
      </div>

      <div className="do-row3">
        <Bars title="By person" items={byPerson} onItem={(id) => onPick({ kind: "person", id })} pickedId={pick?.kind === "person" ? pick.id : null} />
        <Bars title="By harness" items={byHarness} />
        <Bars title="By machine" items={byMachine} />
      </div>
    </>
  );
}

export function DashOverview({ scenario }: { scenario: ScenarioId }) {
  return (
    <HomeShell scenario={scenario} page="home" className="do-page">
      {(data, pick, onPick) => <Page data={data} pick={pick} onPick={onPick} />}
    </HomeShell>
  );
}
