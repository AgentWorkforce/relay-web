// Spend page – where the tokens go and what came out of them: the operator's fourth question
// ("where is the budget going?") together with the customers' "funding effectiveness". One version:
// the summary, four key figures, the tokens over the period, what they bought and one table grouped
// by initiative, person or harness. The side panel answers what this page leaves open: what has no
// result yet, what was spent twice and which single sessions were the biggest.
import { useState, type ReactNode } from "react";
import { ArrowRight, CalendarDays, ChevronDown, CircleCheck, CircleDollarSign, CirclePause, Coins, Copy, FolderOpen, Gauge, SquareTerminal, Users } from "lucide-react";
import { DropdownMenu } from "../../../src/affectui/registry/dropdown-menu/component.clean";
import { fixtureClock, type ScenarioId } from "../scenarios";
import { Frame } from "./Frame";
import { ago, formatTokens, type Overview } from "./model";
import type { Pick } from "./OperatorV1";
import { openPage } from "./pages";
import { HARNESS_NAMES, spendOf, type Spend, type SpendRow } from "./spend";
import { CumulativeChart, HarnessLogo, InitiativeDetail, Initials, SessionDetail, SessionRow } from "./WeekPanel";

const BLUES = ["var(--ar-blue)", "#2fae94", "#9a83d9", "#d98aa6", "#e8a200"];
const pct = (n: number) => `${Math.round(n * 100)}%`;
const periodWord = (data: Overview) => (data.period.days === 1 ? "today" : data.period.days === 7 ? "this week" : "this month");

function Shell({ scenario, className, children }: { scenario: ScenarioId; className: string; children: (data: Overview, spend: Spend, pick: Pick | null, onPick: (p: Pick) => void) => ReactNode }) {
  return (
    <Frame
      scenario={scenario}
      page="spend"
      title="Spend"
      className={className}
      idle={{ title: "This week", render: (data, onPick) => <SpendWeekPanel data={data} onPick={onPick} /> }}
      detail={{
        initiative: (item, tab, onSession) => <InitiativeDetail item={item} tab={tab} onSession={onSession} />,
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {(data, pick, onPick) =>
        data.analysis === "empty" ? (
          <div className="o2-empty">
            <h2>No recorded work yet</h2>
            <p>Once agents record work, this page shows where the tokens go and what came out of them.</p>
          </div>
        ) : (
          children(data, spendOf(data), pick, onPick)
        )
      }
    </Frame>
  );
}

function Lede({ data, spend }: { data: Overview; spend: Spend }) {
  const finished = spend.outcomes.find((o) => o.id === "finished")!.tokens;
  return (
    <section className="o2-hero" aria-label="Summary">
      <p className="o2-eyebrow">
        {data.org} · {data.workspace}
      </p>
      <h2 className="o2-headline">
        {formatTokens(spend.total)} tokens {periodWord(data)} – {pct(spend.total ? finished / spend.total : 0)} went into finished work.
      </h2>
      <p className="o2-sub">
        {spend.tokenSessions} of {spend.sessions} sessions report tokens · cost isn't reported yet
      </p>
    </section>
  );
}

/** What the tokens bought: one bar, finished / running / paused, and the part spent twice under it */
function Bought({ spend }: { spend: Spend }) {
  const parts = spend.outcomes.filter((o) => o.id !== "twice");
  const twice = spend.outcomes.find((o) => o.id === "twice")!;
  return (
    <section className="o2-section" aria-label="What the tokens bought">
      <h2 className="o2-h">What the tokens bought</h2>
      <div className="sp-bought">
        <span className="sp-stack" aria-hidden="true">
          {parts.map((p) => (p.tokens ? <span key={p.id} data-part={p.id} style={{ flexGrow: p.tokens }} /> : null))}
        </span>
        <ul className="sp-legend">
          {parts.map((p) => (
            <li key={p.id}>
              <span className="sp-swatch" data-part={p.id} />
              <span className="sp-legend__name">{p.label}</span>
              <span className="o2-num">{formatTokens(p.tokens)}</span>
              <span className="o2-num o2-muted">{pct(spend.total ? p.tokens / spend.total : 0)}</span>
            </li>
          ))}
        </ul>
        {twice.tokens > 0 && (
          <button type="button" data-slot="sp-twice" className="sp-twice" onClick={() => openPage("overlaps")}>
            <span className="o-cat__dot" data-cat="waste" aria-hidden="true" />
            About {formatTokens(twice.tokens)} of it was spent on work done twice – see Overlaps
          </button>
        )}
      </div>
    </section>
  );
}

function Table({
  title,
  heading,
  column,
  rows,
  onRow,
  pick,
  lead,
}: {
  title: string;
  /** Replaces the plain heading – e.g. "By ▾ Initiative" with a picker */
  heading?: ReactNode;
  /** The first column's label (default: from the title) */
  column?: string;
  rows: SpendRow[];
  onRow?: (r: SpendRow) => void;
  pick?: string | null;
  /** What leads the row's name: a person's initials, a harness logo, a folder */
  lead?: (r: SpendRow) => ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <section className="o2-section" aria-label={title}>
      {heading ?? <h2 className="o2-h">{title}</h2>}
      <div className="o2-table sp-table" role="list">
        <div className="o2-table__head" aria-hidden="true">
          <span>{column ?? title.replace("By ", "").replace(/^./, (c) => c.toUpperCase())}</span>
          <span>Tokens</span>
          <span className="o2-num">Sessions</span>
          <span className="o2-num">Finished</span>
          <span className="o2-num">Per finished</span>
        </div>
        {rows.map((r) => {
          const cells = (
            <>
              <span className="o2-row__name sp-name">
                {lead?.(r)}
                {r.name}
              </span>
              <span className="sp-bar">
                <span className="sp-bar__track">
                  <span style={{ width: `${(r.tokens / max) * 100}%` }} />
                </span>
                <span className="o2-num">{formatTokens(r.tokens)}</span>
              </span>
              <span className="o2-num">{r.sessions}</span>
              <span className="o2-num">{r.finished}</span>
              <span className={`o2-num${r.perFinished === null ? " o2-muted" : ""}`}>{r.perFinished === null ? "–" : formatTokens(r.perFinished)}</span>
            </>
          );
          return onRow ? (
            <button key={r.id} type="button" role="listitem" data-slot="o2-row" className="o2-row" aria-pressed={pick === r.id} onClick={() => onRow(r)}>
              {cells}
            </button>
          ) : (
            <div key={r.id} role="listitem" className="o2-row o2-row--static">
              {cells}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Four KPIs in one framed strip, label and icon on top, the figure under it (like Profound's overview) */
function Kpis({ spend }: { spend: Spend }) {
  const finished = spend.outcomes.find((o) => o.id === "finished")!.tokens;
  const twice = spend.outcomes.find((o) => o.id === "twice")!.tokens;
  const top = spend.byInitiative[0];
  const items: { label: string; value: string; note?: string; icon: ReactNode }[] = [
    { label: "Tokens", value: formatTokens(spend.total), note: `${spend.tokenSessions} of ${spend.sessions} sessions`, icon: <Coins size={16} aria-hidden="true" /> },
    { label: "Into finished work", value: pct(spend.total ? finished / spend.total : 0), note: `${formatTokens(finished)} tokens`, icon: <CircleCheck size={16} aria-hidden="true" /> },
    { label: "Spent twice", value: `~${formatTokens(twice)}`, note: "see Overlaps", icon: <Copy size={16} aria-hidden="true" /> },
    { label: "Biggest initiative", value: top?.name ?? "–", note: top ? `${pct(top.share)} of all tokens` : undefined, icon: <FolderOpen size={16} aria-hidden="true" /> },
  ];
  return (
    <section className="sp-kpis" aria-label="Key figures">
      {items.map((k) => (
        <div key={k.label} className="sp-kpi">
          <span className="sp-kpi__head">
            <span>{k.label}</span>
            {k.icon}
          </span>
          <span className={`sp-kpi__value${/\d/.test(k.value) ? "" : " sp-kpi__value--text"}`} title={k.value}>
            {k.value}
          </span>
          {k.note && <span className="sp-kpi__note">{k.note}</span>}
        </div>
      ))}
    </section>
  );
}

/** Tokens over the period: title and the group switch on top, the total, the legend on its own line, the chart */
function OverTime({ data, spend }: { data: Overview; spend: Spend }) {
  const [dim, setDim] = useState<Dim>("initiative");
  const series = groupsBy(data, dim).map((g, i) => ({
    id: `spo-${dim}-${g.id}`,
    name: g.name,
    color: BLUES[i % BLUES.length]!,
    events: g.sessions.filter((x) => x.tokens !== null).map((x) => ({ t: Date.parse(x.lastTs), n: x.tokens! })),
  }));
  return (
    <section className="sp-card" aria-label="Tokens over the period">
      <div className="sp-card__top">
        <span className="sp-card__title">Tokens over the period</span>
        <DimSwitch value={dim} onChange={setDim} />
      </div>
      <div className="sp-card__head">
        <span className="sp-card__total">{formatTokens(spend.total)}</span>
      </div>
      {/* The legend on its own line, clear of the switch above it */}
      <ul className="o-chart__legend sp-card__legend sp-card__keys">
        {series.map((g) => (
          <li key={g.id} title={g.name}>
            <span style={{ background: g.color }} /> {g.name}
          </li>
        ))}
      </ul>
      <div className="sp-card__chart">
        <CumulativeChart axes label="tokens over the period" series={series} />
      </div>
    </section>
  );
}


/* ---------- The page ---------- */

const GROUPINGS = [
  { id: "initiative", label: "Initiative", icon: FolderOpen },
  { id: "person", label: "Person", icon: Users },
  { id: "harness", label: "Harness", icon: SquareTerminal },
] as const;
type Grouping = (typeof GROUPINGS)[number]["id"];

/** "By ▸ Initiative ▾": one table, its grouping picked in the heading */
function GroupingHeading({ value, onChange }: { value: Grouping; onChange: (g: Grouping) => void }) {
  const current = GROUPINGS.find((g) => g.id === value)!;
  const Icon = current.icon;
  return (
    <h2 className="o2-h sp-by">
      By
      <DropdownMenu
        align="start"
        items={GROUPINGS.map((g) => ({ label: g.label, icon: g.icon, checked: g.id === value, onSelect: () => onChange(g.id) }))}
        trigger={({ toggle, triggerProps }) => (
          <button type="button" data-slot="sp-by" className="sp-by__btn" {...triggerProps} onClick={toggle}>
            <Icon size={15} aria-hidden="true" />
            {current.label}
            <ChevronDown size={14} aria-hidden="true" className="sp-by__chev" />
          </button>
        )}
      />
    </h2>
  );
}

export function SpendPage({ scenario }: { scenario: ScenarioId }) {
  const [grouping, setGrouping] = useState<Grouping>("initiative");
  return (
    <Shell scenario={scenario} className="o2">
      {(data, spend, pick, onPick) => (
        <>
          <Lede data={data} spend={spend} />
          <Kpis spend={spend} />
          <OverTime data={data} spend={spend} />
          <Bought spend={spend} />
          <Table
            title={`By ${grouping}`}
            heading={<GroupingHeading value={grouping} onChange={setGrouping} />}
            column={GROUPINGS.find((g) => g.id === grouping)!.label}
            rows={grouping === "initiative" ? spend.byInitiative : grouping === "person" ? spend.byPerson : spend.byHarness}
            pick={grouping === "initiative" && pick?.kind === "initiative" ? pick.id : null}
            onRow={grouping === "initiative" && data.initiatives.length ? (r) => onPick({ kind: "initiative", id: r.id }) : undefined}
            lead={(r) =>
              grouping === "initiative" ? (
                <FolderOpen size={14} aria-hidden="true" className="o-lead-icon" />
              ) : grouping === "person" ? (
                <Initials name={r.name} />
              ) : (
                <HarnessLogo source={r.id} />
              )
            }
          />
          <p className="o2-foot">“Finished” means the session ended on its own – the closest the data gets to “it produced something” today. Per finished = tokens of finished sessions ÷ their number.</p>
        </>
      )}
    </Shell>
  );
}

type Dim = "initiative" | "person" | "harness" | "model";

/** The sessions split by one dimension – the chart draws a line per group */
function groupsBy(data: Overview, dim: Dim) {
  const all = data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions);
  if (dim === "initiative")
    return data.initiatives.length
      ? data.initiatives.map((g) => ({ id: g.id, name: g.name, sessions: g.sessions }))
      : data.projects.map((p) => ({ id: p.name, name: p.name, sessions: p.sessions }));
  const by = (key: (s: (typeof all)[number]) => string, name: (k: string) => string = (k) => k) =>
    [...new Set(all.map(key))].map((k) => ({ id: k, name: name(k), sessions: all.filter((s) => key(s) === k) }));
  if (dim === "person") return by((s) => s.person?.name ?? "Unknown");
  if (dim === "harness") return by((s) => s.source, (k) => HARNESS_NAMES[k] ?? k);
  return [{ id: "synthetic-model", name: "synthetic-model", sessions: all }];
}

/** Initiative · Person · Harness · Model – the chart's segmented switch */
function DimSwitch({ value, onChange }: { value: Dim; onChange: (d: Dim) => void }) {
  return (
    <div className="o2-seg" role="tablist" aria-label="Group by">
      {(["initiative", "person", "harness", "model"] as const).map((d) => (
        <button key={d} type="button" role="tab" data-slot="o2-seg" aria-selected={value === d} onClick={() => onChange(d)}>
          {d.charAt(0).toUpperCase() + d.slice(1)}
        </button>
      ))}
    </div>
  );
}

/* ---------- The Spend page's side panel while nothing is picked ---------- */

/**
 * What the page itself doesn't answer: the chart, the totals and the breakdowns are already in the
 * main area, so the panel doesn't repeat them. It lists where tokens went without a result yet, what
 * was spent twice (each overlap opens right here), and the single biggest sessions.
 */
function SpendWeekPanel({ data, onPick }: { data: Overview; onPick: (p: Pick) => void }) {
  if (data.analysis === "empty")
    return (
      <div className="o-pane__empty o-week__empty">
        <p>Nothing recorded in this period.</p>
      </div>
    );
  const spend = spendOf(data);
  const finished = spend.outcomes.find((o) => o.id === "finished")!.tokens;
  const paused = spend.outcomes.find((o) => o.id === "paused")!.tokens;
  const twice = spend.outcomes.find((o) => o.id === "twice")!.tokens;
  // Initiatives that used tokens but finished nothing yet – the "is this paying off?" list
  const noResult = spend.byInitiative.filter((r) => r.tokens > 0 && r.finished === 0);
  const twiceList = data.overlaps.filter((o) => o.duplicateTokens).sort((a, b) => b.duplicateTokens! - a.duplicateTokens!);
  const canOpen = (id: string) => data.initiatives.some((i) => i.id === id);
  return (
    <div className="o-week">
      <section className="o-card" aria-label="Properties">
        <h3 className="o-card__title">Properties</h3>
        <dl className="o-props">
          <dt>Period</dt>
          <dd>
            <CalendarDays size={14} aria-hidden="true" /> {data.period.label}
          </dd>
          <dt>Tokens</dt>
          <dd>
            <Coins size={14} aria-hidden="true" /> {formatTokens(spend.total)}
          </dd>
          <dt>Finished</dt>
          <dd>
            <CircleCheck size={14} aria-hidden="true" /> {pct(spend.total ? finished / spend.total : 0)} of the tokens
          </dd>
          <dt>Cost</dt>
          <dd className="o-props__muted">
            <CircleDollarSign size={14} aria-hidden="true" /> Not reported yet
          </dd>
          <dt>Coverage</dt>
          <dd>
            <Gauge size={14} aria-hidden="true" /> {spend.tokenSessions} of {spend.sessions} sessions
          </dd>
          <dt>Harnesses</dt>
          <dd className="o-props__stack">
            {spend.byHarness.map((h) => (
              <span key={h.id}>
                <HarnessLogo source={h.id} /> {h.name}
              </span>
            ))}
          </dd>
        </dl>
      </section>

      <section className="o-card" aria-label="No result yet">
        <h3 className="o-card__title">No result yet</h3>
        {noResult.length ? (
          <ul className="o-activity">
            {noResult.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-slot="o-activity"
                  className="o-activity__row ov-recent"
                  disabled={!canOpen(r.id)}
                  onClick={() => onPick({ kind: "initiative", id: r.id })}
                >
                  <FolderOpen size={14} aria-hidden="true" className="o-lead-icon" />
                  <span className="o-activity__text">
                    <span className="o-activity__title">{r.name}</span>
                    <span className="o-activity__meta">
                      {formatTokens(r.tokens)} tokens · {r.sessions} {r.sessions === 1 ? "session" : "sessions"}, none finished
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="o-card__text">Every initiative that used tokens finished something.</p>
        )}
        {paused > 0 && (
          <p className="o-note sp-note">
            <CirclePause size={14} aria-hidden="true" /> {formatTokens(paused)} tokens sit in paused sessions
          </p>
        )}
      </section>

      <section className="o-card" aria-label="Spent twice">
        <h3 className="o-card__title">Spent twice</h3>
        {twiceList.length ? (
          <>
            <ul className="o-activity">
              {twiceList.map((o) => (
                <li key={o.id}>
                  <button type="button" data-slot="o-activity" className="o-activity__row ov-recent" onClick={() => onPick({ kind: "overlap", id: o.id })}>
                    <span className="o-cat__dot" data-cat={o.category} aria-hidden="true" />
                    <span className="o-activity__text">
                      <span className="o-activity__title">{o.title}</span>
                      <span className="o-activity__meta">
                        ~{formatTokens(o.duplicateTokens!)} tokens · {o.kindLabel}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" data-slot="sp-link" className="sp-link" onClick={() => openPage("overlaps")}>
              ~{formatTokens(twice)} in all – open Overlaps <ArrowRight size={14} aria-hidden="true" />
            </button>
          </>
        ) : (
          <p className="o-card__text">Nothing was done twice in this period.</p>
        )}
      </section>

      <section className="o-card" aria-label="Biggest sessions">
        <h3 className="o-card__title">Biggest sessions</h3>
        <ul className="o-activity">
          {spend.biggest.map((s) => (
            <SessionRow key={s.id} s={s} onOpen={() => onPick({ kind: "session", id: s.id, from: null })} />
          ))}
        </ul>
        <p className="o-note">Updated {ago(fixtureClock, fixtureClock).toLowerCase()}</p>
      </section>
    </div>
  );
}
