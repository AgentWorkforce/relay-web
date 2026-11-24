// v2's side panel while nothing is picked – the week at a glance, laid out like Linear's initiative
// sidebar: a properties card, a progress chart with a breakdown underneath, and the latest activity.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Bug, CalendarDays, Circle, CircleDollarSign, Clock, Code2, Coins, Eye, Flag, FlaskConical, Map as MapIcon, MessageCircle, MessagesSquare, Monitor, Search, TriangleAlert } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { HarnessIcon } from "../../../src/sessions/harness-icon";
import { ago, formatTokens, type Initiative, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";

// One color per initiative line: the brand blue first, then two calm companions
const LINES = ["var(--ar-blue)", "#2fae94", "#9a83d9", "#d98aa6"];
const shade = (i: number) => LINES[i % LINES.length]!;

export function WeekPanel({ data, onPick }: { data: Overview; onPick: (p: Pick) => void }) {
  const groups = data.initiatives.length
    ? data.initiatives.map((i) => ({ id: i.id, name: i.name, sessions: i.sessions }))
    : data.projects.map((p) => ({ id: p.name, name: p.name, sessions: p.sessions }));
  const sessions = groups.flatMap((g) => g.sessions);
  const people = [...new Map(sessions.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()];
  const atRisk = data.initiatives.filter((i) => i.health === "at-risk").length;

  if (data.analysis === "empty")
    return (
      <div className="o-pane__empty o-week__empty">
        <p>Nothing recorded this week yet.</p>
      </div>
    );

  return (
    <div className="o-week">
      <section className="o-card" aria-label="Properties">
        <h3 className="o-card__title">Properties</h3>
        {/* Label left, value right – each value with its icon, a value with several entries one per line */}
        <dl className="o-props">
          <dt>Period</dt>
          <dd>
            <CalendarDays size={14} aria-hidden="true" /> {data.period.label}
          </dd>
          {data.initiatives.length > 0 && (
            <>
              <dt>Initiatives</dt>
              <dd className="o-props__stack">
                <span>
                  <span className="o2-health__dot" /> {data.initiatives.length - atRisk} on track
                </span>
                {atRisk > 0 && (
                  <span>
                    <span className="o2-health__dot" data-risk /> {atRisk} at risk
                  </span>
                )}
              </dd>
            </>
          )}
          <dt>People</dt>
          <dd className="o-props__stack">
            {people.map((p) => (
              <span key={p.id}>
                <Initials name={p.name} />
                {p.name}
              </span>
            ))}
          </dd>
          <dt>Sessions</dt>
          <dd>
            <MessagesSquare size={14} aria-hidden="true" /> {data.sessions}
          </dd>
          <dt>Tokens</dt>
          <dd>
            <Coins size={14} aria-hidden="true" /> {formatTokens(data.budget.tokens)}
          </dd>
          <dt>Cost</dt>
          <dd className="o-props__muted">
            <CircleDollarSign size={14} aria-hidden="true" /> Not reported yet
          </dd>
        </dl>
      </section>

      <TokensCard data={data} groups={groups} />

      <section className="o-card" aria-label="Activity">
        <h3 className="o-card__title">Activity</h3>
        <ul className="o-activity">
          {[...sessions]
            .sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs))
            .slice(0, 5)
            .map((s) => (
              // Two calm lines: what the work is, then who / where it stands / when – one weight, two tones
              <li key={s.id}>
                <button type="button" data-slot="o-activity" className="o-activity__row" onClick={() => onPick({ kind: "session", id: s.id, from: null })}>
                  {s.person && <Initials name={s.person.name} />}
                  <span className="o-activity__text">
                    <span className="o-activity__title">{s.title}</span>
                    <span className="o-activity__meta">
                      {s.person?.name.split(" ")[0]} · {state(s)} · {ago(s.lastTs, fixtureClock)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

/** A harness's own logo (Claude, Codex, Cursor …) from the dashboard's icon set, in a small round tile */
export function HarnessLogo({ source }: { source: string }) {
  return (
    <span className="o-logo" aria-hidden="true">
      <HarnessIcon source={source} className="o-logo__img" />
    </span>
  );
}
export const HARNESS_LABELS: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", opencode: "OpenCode", gemini: "Gemini" };

/** A person as a round initials badge */
export function Initials({ name }: { name: string }) {
  return (
    <span className="o-initials" aria-hidden="true">
      {name
        .split(" ")
        .map((part) => part[0])
        .join("")}
    </span>
  );
}

/** The kinds of work the analysis tells apart, each with its icon */
const WORK_ICONS: Record<string, typeof Circle> = {
  implementation: Code2,
  testing: FlaskConical,
  debugging: Bug,
  review: Eye,
  planning: MapIcon,
  research: Search,
  conversation: MessageCircle,
};

export type ChartSeries = {
  id: string;
  name: string;
  /** The legend's label, if the name's first word doesn't work on its own */
  short?: string;
  color: string;
  events: { t: number; n: number }[];
};

/**
 * Running totals over time, one line per series with a fill fading out below it, an axis, a one-line
 * legend and a hover layer (guide, a dot per line, a card with each series' total at that moment).
 */
export function CumulativeChart({ series, label, axes = false }: { series: ChartSeries[]; label: string; /** Gridlines and a y-axis column – for wide charts */ axes?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapW, setWrapW] = useState(0);
  // The hover card's real width, measured once it's shown, so it's always placed fully inside the chart
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(176);
  useLayoutEffect(() => {
    if (cardRef.current && cardRef.current.offsetWidth !== cardW) setCardW(cardRef.current.offsetWidth);
  });
  const W = 280;
  const H = 120;
  const events = series.flatMap((g, gi) => g.events.map((e) => ({ gi, ...e }))).sort((a, b) => a.t - b.t);
  const start = events[0]?.t ?? 0;
  const end = Math.max(events.at(-1)?.t ?? 1, start + 1);
  const total = events.reduce((a, e) => a + e.n, 0);
  const running = series.map(() => 0);
  const points = [{ t: start, totals: [...running] }];
  for (const e of events) {
    running[e.gi]! += e.n;
    points.push({ t: e.t, totals: [...running] });
  }
  const highest = Math.max(1, ...series.map((_, gi) => points.at(-1)!.totals[gi]!));
  // With axes the scale runs to a round top value, so the gridlines fall on readable numbers
  const ticks = axes ? niceTicks(highest) : [];
  const max = axes ? ticks.at(-1)! : highest;
  const x = (t: number) => ((t - start) / (end - start)) * W;
  const y = (v: number) => (axes ? H - (v / max) * H : H - (v / max) * (H - 8) - 1);
  // A line bends only where its own series changed – straight in between, ending at "now"
  const ownPoints = (gi: number) => {
    const own = points.filter((p, i) => i === 0 || p.totals[gi] !== points[i - 1]!.totals[gi]);
    return [...own, { t: end, totals: own.at(-1)!.totals }].map((p) => ({ t: p.t, v: p.totals[gi]! }));
  };
  const coords = (gi: number) => ownPoints(gi).map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  const drawnAt = (gi: number, t: number) => {
    const own = ownPoints(gi);
    const i = own.findIndex((p) => p.t >= t);
    if (i <= 0) return own[Math.max(0, i)]!.v;
    const a = own[i - 1]!, b = own[i]!;
    return a.v + ((t - a.t) / Math.max(1, b.t - a.t)) * (b.v - a.v);
  };
  const ht = hover === null ? 0 : start + hover * (end - start);
  const hp = hover === null ? null : ([...points].reverse().find((q) => q.t <= ht) ?? points[0]!);
  const chart = (
    <>
      <div
        className="o-chart__wrap"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
          setWrapW(r.width);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {axes && (
          <div className="o-chart__grid" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} style={{ top: `${(1 - t / max) * 100}%` }} />
            ))}
          </div>
        )}
        <svg className="o-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${formatTokens(total)} ${label}`}>
          <defs>
            {series.map((g) => (
              <linearGradient key={g.id} id={fadeId(g.id)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={g.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={g.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {series.map((g, gi) => (
            <path key={`a-${g.id}`} d={`M0,${H}L${coords(gi).join("L")}L${W},${H}Z`} fill={`url(#${fadeId(g.id)})`} />
          ))}
          {series.map((g, gi) => (
            <path key={`l-${g.id}`} d={`M${coords(gi).join("L")}`} fill="none" stroke={g.color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {hover !== null && hp && (
          <div className="o-hover" aria-hidden="true">
            <span className="o-hover__guide" style={{ left: `${hover * 100}%` }} />
            {series.map((g, gi) => (
              <span key={g.id} className="o-hover__dot" style={{ left: `${hover * 100}%`, top: `${(y(drawnAt(gi, ht)) / H) * 100}%`, background: g.color }} />
            ))}
            <div ref={cardRef} className="o-hover__card" style={{ left: cardLeft(hover * wrapW, wrapW, cardW) }}>
              <span className="o-hover__time">{ago(new Date(ht).toISOString(), fixtureClock)}</span>
              {series.map((g, gi) => (
                <span key={g.id} className="o-hover__row">
                  <span className="o-hover__swatch" style={{ background: g.color }} />
                  <span className="o-hover__name">{g.name}</span>
                  <span className="o2-num">{formatTokens(hp.totals[gi]!)}</span>
                </span>
              ))}
              <span className="o-hover__row o-hover__total">
                <span className="o-hover__name">Total</span>
                <span className="o2-num">{formatTokens(hp.totals.reduce((a, b) => a + b, 0))}</span>
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="o-chart__axis">
        <span>{ago(new Date(start).toISOString(), fixtureClock)}</span>
        <span>Now</span>
      </div>
    </>
  );
  return (
    <>
      {axes ? (
        <div className="o-chart__frame">
          <div className="o-chart__yaxis" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} style={{ top: `${(1 - t / max) * 100}%` }}>
                {formatTokens(t)}
              </span>
            ))}
          </div>
          <div className="o-chart__main">{chart}</div>
        </div>
      ) : (
        chart
      )}
      <ul className="o-chart__legend">
        {series.map((g) => (
          <li key={g.id} title={g.name}>
            <span style={{ background: g.color }} /> {g.short ?? short(g.name)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** A gradient id that works inside url(#…): series ids can hold spaces or dots ("Ana Silva") */
const fadeId = (id: string) => `o-fade-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** The hover card's left edge: beside the guide where it fits (right first), else centred and kept inside */
function cardLeft(x: number, width: number, cardW: number) {
  if (x + 10 + cardW <= width) return x + 10;
  if (x - 10 - cardW >= 0) return x - 10 - cardW;
  return Math.min(Math.max(0, x - cardW / 2), Math.max(0, width - cardW));
}

/** Round gridline values from 0 to just above the highest value: 0, 10k, 20k … (four or five steps) */
function niceTicks(highest: number) {
  const raw = highest / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(highest / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step));
}

/** The legend's short label: the first word ("Edge migration" → "Edge"); the full name stays in the tooltip */
const short = (name: string) => name.split(" ")[0]!;

const state = (s: SessionItem) => (s.status === "finished" ? "Finished" : s.status === "active" ? "Working" : "Paused")

/** Cumulative tokens over the week, one band per initiative, and a switchable breakdown underneath */
function TokensCard({ data, groups }: { data: Overview; groups: { id: string; name: string; sessions: SessionItem[] }[] }) {
  const [by, setBy] = useState<"health" | "people" | "work">(data.initiatives.length ? "health" : "people");
  // Each row leads with what it is: a health dot, a person's initials, or the kind of work's icon
  const rows: { label: string; n: string | number; lead: ReactNode }[] =
    by === "health"
      ? [
          { label: "On track", n: data.initiatives.filter((i) => i.health === "on-track").length, lead: <span className="o2-health__dot o-lead-dot" /> },
          { label: "At risk", n: data.initiatives.filter((i) => i.health === "at-risk").length, lead: <span className="o2-health__dot o-lead-dot" data-risk /> },
        ]
      : by === "people"
        ? data.budget.byPerson.map((p) => ({ label: p.name, n: formatTokens(p.tokens), lead: <Initials name={p.name} /> }))
        : data.budget.workTypes.map((w) => {
            const Icon = WORK_ICONS[w.name] ?? Circle;
            return { label: w.name.charAt(0).toUpperCase() + w.name.slice(1), n: w.sessions, lead: <Icon size={14} aria-hidden="true" className="o-lead-icon" /> };
          });

  return (
    <section className="o-card" aria-label="Tokens over the week">
      <h3 className="o-card__title">Tokens</h3>
      <CumulativeChart
        label="tokens, building up over the week"
        series={groups.map((g, gi) => ({
          id: g.id,
          name: g.name,
          color: shade(gi),
          events: g.sessions.filter((x) => x.tokens !== null).map((x) => ({ t: Date.parse(x.lastTs), n: x.tokens! })),
        }))}
      />
      <div className="o-seg" role="tablist" aria-label="Break down by">
        {(data.initiatives.length ? (["health", "people", "work"] as const) : (["people"] as const)).map((d) => (
          <button key={d} type="button" role="tab" data-slot="o-seg" aria-selected={by === d} onClick={() => setBy(d)}>
            {d === "health" ? "Health" : d === "people" ? "People" : "Work"}
          </button>
        ))}
      </div>
      <ul className="o-breakdown">
        {rows.map((r) => (
          <li key={r.label}>
            {r.lead}
            <span className="o-breakdown__label">{r.label}</span>
            <span className="o2-num">{r.n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- v2's detail views: the same cards, icons and rows as the week panel ---------- */

/** Opens a session in the workbench's real dashboard (no-op outside the workbench) */
function openTranscript(sessionId: string) {
  if (window.parent !== window) window.parent.postMessage({ type: "design-open-session", sessionId }, window.location.origin);
}

/** A session as a compact two-line row: title, then person · tokens · state */
export function SessionRow({ s, onOpen }: { s: SessionItem; onOpen: () => void }) {
  return (
    <li>
      <button type="button" data-slot="o-activity" className="o-activity__row" onClick={onOpen}>
        {s.person && <Initials name={s.person.name} />}
        <span className="o-activity__text">
          <span className="o-activity__title">{s.title}</span>
          <span className="o-activity__meta o-activity__meta--logo">
            <HarnessLogo source={s.source} />
            {s.person?.name.split(" ")[0]} · {formatTokens(s.tokens)} tokens · {state(s)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function InitiativeDetail({ item, tab, onSession }: { item: Initiative; tab: string; onSession: (id: string) => void }) {
  return (
    <div className="o-week o-week--detail">
      {tab === "Overview" && (
        <>
          <section className="o-card" aria-label={item.name}>
            <div className="o-card__head">
              <h2 className="o-card__name">{item.name}</h2>
              {item.goal && <p className="o-card__sub">{item.goal}</p>}
            </div>
            <dl className="o-props">
              <dt>Health</dt>
              <dd>
                <span className="o2-health__dot o-lead-dot" data-risk={item.health === "at-risk" || undefined} />
                {item.health === "at-risk" ? "At risk" : "On track"}
              </dd>
              <dt>Status</dt>
              <dd>
                <Flag size={14} aria-hidden="true" /> {item.status}
              </dd>
              <dt>People</dt>
              <dd className="o-props__stack">
                {item.people.map((p) => (
                  <span key={p.id}>
                    <Initials name={p.name} />
                    {p.name}
                  </span>
                ))}
              </dd>
              <dt>Sessions</dt>
              <dd>
                <MessagesSquare size={14} aria-hidden="true" /> {item.sessions.length}
              </dd>
              <dt>Tokens</dt>
              <dd>
                <Coins size={14} aria-hidden="true" /> {formatTokens(item.tokens)}
              </dd>
              <dt>Updated</dt>
              <dd>
                <Clock size={14} aria-hidden="true" /> {ago(item.lastTs, fixtureClock)}
              </dd>
            </dl>
          </section>
          <section className="o-card" aria-label="Latest update">
            <h3 className="o-card__title">Latest update</h3>
            <p className="o-card__text">{item.update}</p>
            {item.blocker && (
              <p className="o-card__blocker">
                <TriangleAlert size={14} aria-hidden="true" /> {item.blocker}
              </p>
            )}
          </section>
        </>
      )}
      {tab === "Prompts" && (
        <section className="o-card" aria-label="What people asked">
          <h3 className="o-card__title">What people asked their agents</h3>
          <ul className="o-quotes">
            {[...new globalThis.Map(item.sessions.map((s) => [s.prompt, s])).values()].map((s) => (
              <li key={s.id}>
                {s.person && <Initials name={s.person.name} />}
                <span>
                  <span className="o-quotes__text">“{s.prompt}”</span>
                  <span className="o-activity__meta">{s.person?.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "Sessions" && (
        <section className="o-card" aria-label="Sessions">
          <h3 className="o-card__title">{item.sessions.length} sessions</h3>
          <ul className="o-activity">
            {item.sessions.map((s) => (
              <SessionRow key={s.id} s={s} onOpen={() => onSession(s.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function SessionDetail({ item, tab }: { item: SessionItem; tab: string }) {
  const WorkIcon = (item.workType && WORK_ICONS[item.workType]) || Circle;
  return (
    <div className="o-week o-week--detail">
      {tab === "Summary" ? (
        <>
          <section className="o-card" aria-label={item.title}>
            <div className="o-card__head">
              <h2 className="o-card__name">{item.title}</h2>
            </div>
            <dl className="o-props">
              <dt>Person</dt>
              <dd>
                {item.person && <Initials name={item.person.name} />} {item.person?.name}
              </dd>
              <dt>Agent</dt>
              <dd>
                <HarnessLogo source={item.source} /> {item.agent}
              </dd>
              <dt>Status</dt>
              <dd>
                <span className="o-activity__dot o-lead-dot" data-status={item.status} aria-hidden="true" /> {state(item)}
              </dd>
              <dt>Updated</dt>
              <dd>
                <Clock size={14} aria-hidden="true" /> {ago(item.lastTs, fixtureClock)}
              </dd>
            </dl>
          </section>
          <section className="o-card" aria-label="Asked">
            <h3 className="o-card__title">Asked</h3>
            <p className="o-card__text">“{item.prompt}”</p>
          </section>
          <section className="o-card" aria-label="Result">
            <h3 className="o-card__title">Result</h3>
            <p className="o-card__text">{item.result}</p>
          </section>
        </>
      ) : (
        <section className="o-card" aria-label="Details">
          <h3 className="o-card__title">Details</h3>
          <dl className="o-props">
            <dt>Tokens</dt>
            <dd>
              <Coins size={14} aria-hidden="true" /> {item.tokens === null ? "Not recorded" : formatTokens(item.tokens)}
            </dd>
            <dt>Harness</dt>
            <dd>
              <HarnessLogo source={item.source} /> {HARNESS_LABELS[item.source] ?? item.source}
            </dd>
            <dt>Machine</dt>
            <dd>
              <Monitor size={14} aria-hidden="true" /> {item.machine ?? "Unknown"}
            </dd>
            {item.workType && (
              <>
                <dt>Kind of work</dt>
                <dd>
                  <WorkIcon size={14} aria-hidden="true" /> {item.workType.charAt(0).toUpperCase() + item.workType.slice(1)}
                </dd>
              </>
            )}
          </dl>
          <button type="button" data-slot="o-open" className="o-open" onClick={() => openTranscript(item.id)}>
            Open transcript <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </section>
      )}
    </div>
  );
}
