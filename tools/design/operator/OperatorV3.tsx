// Operator view v3 – "Board": the initiatives by stage, as a calm board in the manner of Linear's
// issue board and Ordinary's inbox board – gray columns with a status icon, name and count; white
// cards with the status icon before the title, a short description, small chips and the people.
// No tiles, no extra boxes: the week's numbers live in the right panel.
import { Coins, MessagesSquare, TriangleAlert, Users } from "lucide-react";
import type { ScenarioId } from "../scenarios";
import { fixtureClock } from "../scenarios";
import { Frame } from "./Frame";
import { ago, formatTokens, type Initiative, type Overview, type Tone } from "./model";
import { Avatars, type Pick } from "./OperatorV1";
import { InitiativeDetail, SessionDetail, WeekPanel } from "./WeekPanel";

const STAGES: { tone: Tone; label: string; empty: string }[] = [
  { tone: "blocked", label: "At risk", empty: "Nothing at risk" },
  { tone: "progress", label: "In progress", empty: "Nothing in progress" },
  { tone: "review", label: "Ready for review", empty: "Nothing waiting for review" },
];

/** Linear-style status glyphs: a warning ring, a half-filled circle, a checked circle */
function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === "blocked")
    return (
      <svg className="ob-status" data-tone={tone} viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 3.8v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="9.8" r="0.9" fill="currentColor" />
      </svg>
    );
  if (tone === "progress")
    return (
      <svg className="ob-status" data-tone={tone} viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 3a4 4 0 0 1 0 8z" fill="currentColor" />
      </svg>
    );
  return (
    <svg className="ob-status" data-tone={tone} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" fill="currentColor" />
      <path d="M4.4 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--o-ob-card, #fff)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OperatorV3({ scenario }: { scenario: ScenarioId }) {
  return (
    <Frame
      scenario={scenario}
      title="Overview"
      className="ob"
      idle={{ title: "This week", open: true, render: (data, onPick) => <WeekPanel data={data} onPick={onPick} /> }}
      detail={{
        initiative: (item, tab, onSession) => <InitiativeDetail item={item} tab={tab} onSession={onSession} />,
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {(data, pick, onPick) => <Board data={data} pick={pick} onPick={onPick} />}
    </Frame>
  );
}

function Board({ data, pick, onPick }: { data: Overview; pick: Pick | null; onPick: (p: Pick) => void }) {
  if (data.analysis === "empty")
    return (
      <div className="o2-empty">
        <h2>No recorded work yet</h2>
        <p>Initiatives show up here once the team's agents have recorded some work.</p>
      </div>
    );
  if (data.analysis !== "current")
    return (
      <>
        <p className="o2-notice ob-notice">
          The analysis is older than the latest work, so the board waits until it runs again. Sessions and tokens in the panel are current.
        </p>
        <div className="ob-board" style={{ gridTemplateColumns: `repeat(${data.projects.length}, minmax(0, 1fr))` }}>
          {data.projects.map((p) => (
            <div key={p.name} className="ob-col">
              <header className="ob-col__head">
                <span className="ob-col__title">{p.name}</span>
                <span className="ob-col__count">{p.sessions.length}</span>
              </header>
              {p.sessions.map((s) => (
                <div key={s.id} className="ob-card ob-card--static">
                  <span className="ob-card__title">{s.title}</span>
                  <span className="ob-card__desc">{s.person?.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </>
    );

  return (
    <>
      {/* The status in one sentence first – like v1 and v2 – then the numbers, then the board */}
      <section className="o2-hero ob-hero" aria-label="Status">
        <p className="o2-eyebrow">
          {data.org} · {data.workspace}
        </p>
        <h2 className="o2-headline">{headline(data)}</h2>
      </section>
      {/* Four equal KPIs above the board – the stages themselves are the columns, so they aren't repeated here */}
      <section className="ob-kpis" aria-label="Summary">
        <div className="ob-kpi ob-kpi--total">
          <span className="ob-kpi__label">Initiatives</span>
          <span className="ob-kpi__value">{data.initiatives.length}</span>
          <span className="ob-kpi__bar" aria-hidden="true">
            {STAGES.map((stage) => {
              const n = data.initiatives.filter((i) => i.tone === stage.tone).length;
              return n ? <span key={stage.tone} data-tone={stage.tone} style={{ flexGrow: n }} /> : null;
            })}
          </span>
        </div>
        <div className="ob-kpi">
          <span className="ob-kpi__label">
            <MessagesSquare size={14} aria-hidden="true" />
            Sessions
          </span>
          <span className="ob-kpi__value">{data.sessions}</span>
        </div>
        <div className="ob-kpi">
          <span className="ob-kpi__label">
            <Users size={14} aria-hidden="true" />
            People
          </span>
          <span className="ob-kpi__value">{data.people}</span>
        </div>
        <div className="ob-kpi">
          <span className="ob-kpi__label">
            <Coins size={14} aria-hidden="true" />
            Tokens
          </span>
          <span className="ob-kpi__value">{formatTokens(data.budget.tokens)}</span>
        </div>
      </section>
      <section className="ob-board" aria-label="Initiatives by stage">
        {STAGES.map((stage) => {
          const items = data.initiatives.filter((i) => i.tone === stage.tone);
          return (
            <div key={stage.tone} className="ob-col">
              <header className="ob-col__head">
                <StatusIcon tone={stage.tone} />
                <span className="ob-col__title">{stage.label}</span>
                <span className="ob-col__count">{items.length}</span>
              </header>
              {items.length ? (
                items.map((item) => <Card key={item.id} item={item} active={pick?.kind === "initiative" && pick.id === item.id} onPick={onPick} />)
              ) : (
                <p className="ob-col__empty">{stage.empty}</p>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

function headline(data: Overview) {
  const atRisk = data.initiatives.filter((i) => i.health === "at-risk");
  if (atRisk.length === 0) return "Everything is on track.";
  if (atRisk.length === data.initiatives.length) return "Every initiative is at risk.";
  return `Mostly on track – ${atRisk.length === 1 ? `${atRisk[0]!.name} is at risk` : `${atRisk.length} initiatives are at risk`}.`;
}

function Card({ item, active, onPick }: { item: Initiative; active: boolean; onPick: (p: Pick) => void }) {
  return (
    <button type="button" data-slot="ob-card" className="ob-card" aria-pressed={active} onClick={() => onPick({ kind: "initiative", id: item.id })}>
      <span className="ob-card__top">
        <span className="ob-card__meta">Updated {ago(item.lastTs, fixtureClock).toLowerCase()}</span>
        <Avatars people={item.people} />
      </span>
      <span className="ob-card__title">
        <StatusIcon tone={item.tone} />
        {item.name}
      </span>
      {item.goal && <span className="ob-card__desc">{item.goal}</span>}
      {item.blocker && (
        <span className="ob-card__blocker">
          <TriangleAlert size={13} aria-hidden="true" />
          {item.blocker}
        </span>
      )}
      <span className="ob-card__chips">
        <span className="ob-chip">
          <span className="o2-health__dot" data-risk={item.health === "at-risk" || undefined} />
          {item.health === "at-risk" ? "At risk" : "On track"}
        </span>
        <span className="ob-chip">
          <Coins size={12} aria-hidden="true" />
          {formatTokens(item.tokens)}
        </span>
        <span className="ob-chip">
          <MessagesSquare size={12} aria-hidden="true" />
          {item.sessions.length}
        </span>
      </span>
    </button>
  );
}
