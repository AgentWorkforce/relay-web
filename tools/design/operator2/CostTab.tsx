// The task's Cost tab. Cost comes from each session's usage – spread over its runtime, split between its
// main model and the helper model its harness uses for side work (see usageOf in cost.ts).
// On top: the cost in each stretch of time as stacked bars – not a running total, so
// a spike shows as a tall bar instead of disappearing into a steeper slope. Pointing at a bar shows what
// it's made of; clicking it lists the sessions behind it, most expensive first, each opening the session
// in Agent Relay – that's how a spike is traced to its source. A switch colours the bars by model or by
// person, and the table under the chart follows it.
import { useMemo, useState, type ReactNode } from "react";
import { useUrlChoice, useUrlValue } from "./urlState";
import { ArrowRight, X } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, formatTokens, type Initiative, type SessionItem } from "../operator/model";
import { HarnessLogo, Initials } from "../operator/WeekPanel";
import { costOf, costOfAll, formatUSD, modelOf, tokensOf, usageOf, type Usage } from "./cost";
import type { Go } from "./App";
import { SessionLink } from "./SessionLink";
import { artifactOf, outcomeOf, shipped, type Artifact } from "./outcomes";

type Dim = "model" | "person";
const COLORS = ["var(--ar-blue)", "#2fae94", "#9a83d9", "#d98aa6", "#e8a200"];
const OTHER_COLOR = "color-mix(in srgb, var(--ar-ink) 28%, transparent)";
const HOUR = 3_600_000;

/** One stretch of work of one session, on one model */
type Event = Usage & { s: SessionItem };
type Group = { key: string; name: string; icon: ReactNode; color: string; keys: string[]; cost: number; tokens: number };

const personOf = (s: SessionItem) => s.person?.name ?? "Unknown";
const keyOf = (e: Event, dim: Dim) => (dim === "model" ? e.model.name : personOf(e.s));

function groupsOf(events: Event[], dim: Dim): Group[] {
  const by = new Map<string, Event[]>();
  for (const e of events) by.set(keyOf(e, dim), [...(by.get(keyOf(e, dim)) ?? []), e]);
  const all = [...by.entries()]
    .map(([key, list]) => ({
      key,
      name: key,
      icon: dim === "model" ? <HarnessLogo source={list[0]!.model.icon} /> : <Initials name={key} />,
      keys: [key],
      cost: list.reduce((x, e) => x + e.cost, 0),
      tokens: list.reduce((x, e) => x + e.tokens, 0),
    }))
    .sort((x, y) => y.cost - x.cost);
  // Five colours at most – the rest share one grey, so the bars stay readable with twenty models
  const top = all.slice(0, all.length > COLORS.length ? COLORS.length - 1 : COLORS.length).map((g, i) => ({ ...g, color: COLORS[i]! }));
  const rest = all.slice(top.length);
  return rest.length
    ? [
        ...top,
        {
          key: "__other",
          name: `${rest.length} more`,
          icon: null,
          color: OTHER_COLOR,
          keys: rest.map((g) => g.key),
          cost: rest.reduce((x, g) => x + g.cost, 0),
          tokens: rest.reduce((x, g) => x + g.tokens, 0),
        },
      ]
    : top;
}

const label = (t: number, step: number) => {
  const d = new Date(t);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (step >= 24 * HOUR) return day;
  return `${day}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

export function CostTab({ task, days, go }: { task: Initiative; days: number; go: Go }) {
  const [dim, setDim] = useUrlChoice<Dim>("by", ["model", "person"], "model");
  const [hot, setHot] = useState<number | null>(null);
  // The picked bar, kept in the link as its day (or hour)
  const [pickedKey, setPickedKey] = useUrlValue("day");
  const sessions = task.sessions.filter((s) => s.tokens !== null);
  const events: Event[] = useMemo(() => sessions.flatMap((s) => usageOf(s).map((u) => ({ ...u, s }))), [sessions]);
  const groups = useMemo(() => groupsOf(events, dim), [events, dim]);
  const all = [...new Set(events.map((e) => keyOf(e, dim)))];
  const colorOfKey = (key: string) => groups.find((g) => g.keys.includes(key))?.color ?? OTHER_COLOR;
  const colorOf = (s: SessionItem) => colorOfKey(dim === "model" ? modelOf(s).name : personOf(s));

  // One bar per calendar day of the period (per hour when the period is a single day), so a bar always
  // reads as "that day" – each stretch of work counts on the day it happened
  const now = Date.parse(fixtureClock);
  const hourly = days <= 1;
  const step = hourly ? HOUR : 24 * HOUR;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = hourly ? Math.floor(now / HOUR) * HOUR - 23 * HOUR : today.getTime() - (days - 1) * 24 * HOUR;
  const count = hourly ? 24 : days;
  const buckets = Array.from({ length: count }, (_, i) => {
    const from = hourly ? start + i * step : new Date(new Date(start).setDate(new Date(start).getDate() + i)).getTime();
    const inside = events.filter((e) => e.t >= from && e.t < (hourly ? from + step : new Date(new Date(from).setDate(new Date(from).getDate() + 1)).getTime()));
    const bySession = new Map<SessionItem, number>();
    for (const e of inside) bySession.set(e.s, (bySession.get(e.s) ?? 0) + e.cost);
    return {
      i,
      from,
      sessions: [...bySession.entries()].map(([s, cost]) => ({ s, cost })).sort((x, y) => y.cost - x.cost),
      cost: inside.reduce((x, e) => x + e.cost, 0),
      parts: groups
        .map((g) => ({ g, cost: inside.filter((e) => g.keys.includes(keyOf(e, dim))).reduce((x, e) => x + e.cost, 0) }))
        .filter((p) => p.cost > 0),
    };
  });
  const max = Math.max(0.01, ...buckets.map((b) => b.cost));
  const total = costOfAll(sessions);
  const keyOfBucket = (from: number) => {
    const d = new Date(from);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return hourly ? `${day}T${String(d.getHours()).padStart(2, "0")}` : day;
  };
  const found = pickedKey === null ? -1 : buckets.findIndex((b) => keyOfBucket(b.from) === pickedKey);
  const picked = found >= 0 ? found : null;
  const setPicked = (i: number | null) => setPickedKey(i === null ? null : keyOfBucket(buckets[i]!.from));
  const sel = picked === null ? null : buckets[picked];
  // The table lists every model or person, not only the five with a colour
  const rows = all
    .map((key) => {
      const list = events.filter((e) => keyOf(e, dim) === key);
      // Sessions run on this model as their main one (helper models do side work, they don't own results)
      const owned = sessions.filter((s) => (dim === "model" ? modelOf(s).name : personOf(s)) === key);
      // What those sessions produced – plans left out – and what it took
      const made = [...new Set(owned.map(artifactOf).filter((a): a is Artifact => !!a && a.kind !== "claude"))];
      const done = made.filter(shipped).length;
      const ownedCost = costOfAll(owned) ?? 0;
      const wasted = costOfAll(owned.filter((s) => outcomeOf(s) === "none")) ?? 0;
      return {
        key,
        icon: dim === "model" ? <HarnessLogo source={list[0]!.model.icon} /> : <Initials name={key} />,
        cost: list.reduce((x, e) => x + e.cost, 0),
        tokens: list.reduce((x, e) => x + e.tokens, 0),
        owned,
        done,
        perShipped: done ? ownedCost / done : null,
        // How many sessions the results this model / person worked on took, on average – 1× is done in one go
        rework: made.length ? made.reduce((x, a) => x + a.sessions.length, 0) / made.length : null,
        wasted: owned.length ? wasted : null,
        wastedShare: ownedCost ? wasted / ownedCost : 0,
      };
    })
    .sort((x, y) => y.cost - x.cost);

  if (!sessions.length) return <p className="v2-none">No cost yet.</p>;

  return (
    <>
      <section className="v2-section v2-spend" aria-label="Cost over time">
        <div className="v2-spend__top">
          <div className="v2-spend__total">
            <span className="v2s-label">Cost est.</span>
            <span className="v2-spend__value o2-num">{formatUSD(total)}</span>
            <span className="o2-muted">{formatTokens(tokensOf(sessions))} tokens · per {hourly ? "hour" : "day"}</span>
          </div>
          <div className="o2-seg" role="tablist" aria-label="Colour by">
            {(["model", "person"] as const).map((d) => (
              <button key={d} type="button" role="tab" data-slot="o2-seg" aria-selected={dim === d} onClick={() => setDim(d)}>
                {d === "model" ? "Model" : "Person"}
              </button>
            ))}
          </div>
        </div>
        <ul className="v2-spend__keys">
          {groups.map((g) => (
            <li key={g.key}>
              <span style={{ background: g.color }} /> {g.name}
            </li>
          ))}
        </ul>
        <div className="v2-spend__chart" onMouseLeave={() => setHot(null)}>
          <div className="v2-spend__grid" aria-hidden="true">
            {[1, 0.5, 0].map((f) => (
              <span key={f}>
                <em className="o2-num">{formatUSD(max * f)}</em>
              </span>
            ))}
          </div>
          <div className="v2-spend__bars">
            {buckets.map((b) => (
              <button
                key={b.i}
                type="button"
                data-slot="v2-spend-bar"
                className="v2-spend__bar"
                aria-pressed={picked === b.i}
                aria-label={`${label(b.from, step)}: ${formatUSD(b.cost)}`}
                data-dim={(picked !== null && picked !== b.i) || (picked === null && hot !== null && hot !== b.i) || undefined}
                disabled={!b.sessions.length}
                onMouseEnter={() => setHot(b.i)}
                onMouseLeave={() => setHot(null)}
                onClick={() => setPicked(picked === b.i ? null : b.i)}
              >
                <span className="v2-spend__stack" style={{ height: `${(b.cost / max) * 100}%` }}>
                  {b.parts.map((p) => (
                    <span key={p.g.key} style={{ flexGrow: p.cost, background: p.g.color }} />
                  ))}
                </span>
                {hot === b.i && b.sessions.length > 0 && (
                  <span className="v2-spend__tip" data-side={b.i > count / 2 ? "left" : "right"} role="tooltip">
                    <span className="v2-spend__tip-head">{label(b.from, step)}</span>
                    {b.parts.map((p) => (
                      <span key={p.g.key} className="v2-spend__tip-row">
                        <span style={{ background: p.g.color }} /> {p.g.name}
                        <b className="o2-num">{formatUSD(p.cost)}</b>
                      </span>
                    ))}
                    <span className="v2-spend__tip-row v2-spend__tip-total">
                      Total <b className="o2-num">{formatUSD(b.cost)}</b>
                    </span>
                    <span className="v2-spend__tip-hint">Click to see its sessions</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="v2-spend__axis o2-muted" aria-hidden="true">
            <span>{hourly ? ago(new Date(start).toISOString(), fixtureClock) : label(start, step)}</span>
            <span>{hourly ? "Now" : "Today"}</span>
          </div>
        </div>
      </section>

      {sel && (
        <section className="v2-section" aria-label="Sessions in this stretch">
          <div className="v2-section__head">
            <h3 className="v2-h">
              {label(sel.from, step)} <span className="v2-h__total">{formatUSD(sel.cost)}</span>
            </h3>
            <button type="button" data-slot="v2-link" className="v2-link" onClick={() => setPicked(null)}>
              <X size={14} aria-hidden="true" /> Show all
            </button>
          </div>
          <ul className="v2-results">
            {sel.sessions.map(({ s, cost }) => (
                <li key={s.id}>
                  <SessionLink id={s.id} go={go} slot="v2-result" className="v2-result v2-result--cost" title="Open the session">
                    <span className="v2-spend__dot" style={{ background: colorOf(s) }} aria-hidden="true" />
                    <span className="v2-result__main">
                      <span className="v2-result__title">{s.title}</span>
                      <span className="v2-result__meta">
                        {s.person && (
                          <span className="v2-inline">
                            <Initials name={s.person.name} /> {s.person.name}
                          </span>
                        )}
                        <span className="v2-inline">
                          <HarnessLogo source={modelOf(s).icon} /> {modelOf(s).name}
                        </span>
                        <span>{formatUSD(costOf(s))} for the whole session</span>
                      </span>
                    </span>
                    <span className="o2-num v2-result__cost">{formatUSD(cost)}</span>
                    <ArrowRight size={14} aria-hidden="true" className="v2-result__go" />
                  </SessionLink>
                </li>
            ))}
          </ul>
        </section>
      )}

      <section className="v2-section" aria-label={dim === "model" ? "By model" : "By person"}>
        <div className="v2-section__head">
          <h3 className="v2-h">
            {dim === "model" ? "By model" : "By person"} <span className="v2-h__total">{rows.length}</span>
          </h3>
          <span className="v2-cols v2-cols--value" aria-hidden="true">
            <span title="Pull requests, documents and reviews that are out">Shipped</span>
            <span title="What one shipped result cost, all its sessions together">Per shipped</span>
            <span title="Sessions it took per result – more means more rework">Rework</span>
            <span title="What sessions that produced nothing cost – no artifact, or one that was closed">Wasted</span>
            <span>Cost est.</span>
          </span>
        </div>
        <ul className="v2-models v2-models--value">
          {rows.map((row) => {
            const side = !row.owned.length;
            return (
              <li key={row.key}>
                <span className="v2-inline v2-models__name">
                  {row.icon} {row.key}
                  {side && <span className="o2-muted v2-models__side">side work</span>}
                </span>
                <span className="v2-models__track" aria-hidden="true">
                  <span style={{ width: `${(row.cost / Math.max(0.0001, rows[0]!.cost)) * 100}%`, background: colorOfKey(row.key) }} />
                </span>
                <span className="o2-num v2-models__n">{side ? "–" : row.done}</span>
                <span className="o2-num v2-models__n">{row.perShipped === null ? "–" : formatUSD(row.perShipped)}</span>
                <span className="o2-num v2-models__n">{row.rework === null ? "–" : `${row.rework.toFixed(1)}×`}</span>
                <span
                  className="o2-num v2-models__n"
                  data-warn={row.wastedShare >= 0.25 ? "" : undefined}
                  title={row.wasted ? `${Math.round(row.wastedShare * 100)}% of what its own sessions cost` : undefined}
                >
                  {row.wasted === null ? "–" : row.wasted === 0 ? "$0" : formatUSD(row.wasted)}
                </span>
                <span className="o2-num v2-models__n" title={`${formatTokens(Math.round(row.tokens))} tokens`}>
                  {formatUSD(row.cost)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
