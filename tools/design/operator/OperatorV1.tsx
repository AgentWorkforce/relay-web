// Operator view v1 – the CTO / VP Engineering overview, rebuilt from established patterns:
//   • Asana portfolio "Progress": one status sentence at the top, so the page answers "how are we doing?" first
//   • Linear initiatives + project updates: one row per initiative with its health and a written update
//   • Stripe Climate / OpenAI usage: one proportional bar with a legend, switchable by dimension
// Four blocks only – status, initiatives, tokens, worth a look. Everything else lives in the panel.
import { useState } from "react";
import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { fixtureClock, type ScenarioId } from "../scenarios";
import { Frame } from "./Frame";
import { InitiativeDetail, SessionDetail, WeekPanel } from "./WeekPanel";
import { ago, formatTokens, type Initiative, type Overview, type Person, type SessionItem } from "./model";

export type Pick =
  | { kind: "initiative"; id: string }
  | { kind: "overlap"; id: string }
  /** A person of the team (dashboard area) – their usage, projects and sessions */
  | { kind: "person"; id: string }
  /** `from` / `fromOverlap`: what the session was opened from – the back link returns there */
  | { kind: "session"; id: string; from: string | null; fromOverlap?: string; fromPerson?: string };
type Dimension = "initiative" | "person" | "model";

function openTranscript(sessionId: string) {
  if (window.parent !== window)
    window.parent.postMessage({ type: "design-open-session", sessionId }, window.location.origin);
}

export function OperatorV1({ scenario }: { scenario: ScenarioId }) {
  return (
    <Frame
      scenario={scenario}
      title="Overview"
      className="o2"
      // The same side panel as v2: the week at a glance, and detail views in sections with icons
      idle={{ title: "This week", open: true, render: (data, onPick) => <WeekPanel data={data} onPick={onPick} /> }}
      detail={{
        initiative: (item, tab, onSession) => <InitiativeDetail item={item} tab={tab} onSession={onSession} />,
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {(data, pick, onPick) => <Page data={data} pick={pick} onPick={onPick} />}
    </Frame>
  );
}

function Page({ data, pick, onPick }: { data: Overview; pick: Pick | null; onPick: (p: Pick) => void }) {
  if (data.analysis === "empty")
    return (
      <div className="o2-empty">
        <h2>No recorded work yet</h2>
        <p>When people connect their coding agents, this page shows what the team is moving forward and what it costs.</p>
      </div>
    );
  const atRisk = data.initiatives.filter((i) => i.health === "at-risk");
  const current = data.analysis === "current";
  const headline = !current
    ? "The initiative summary is out of date."
    : atRisk.length === 0
      ? "Everything is on track."
      : atRisk.length === data.initiatives.length
        ? "Every initiative is at risk."
        : `Mostly on track – ${atRisk.length === 1 ? `${atRisk[0]!.name} is at risk` : `${atRisk.length} initiatives are at risk`}.`;

  return (
    <>
      <section className="o2-hero" aria-label="Status">
        <p className="o2-eyebrow">
          {data.org} · {data.workspace}
        </p>
        <h2 className="o2-headline">{headline}</h2>
        <p className="o2-sub">
          {current ? `${data.initiatives.length} initiatives · ` : ""}
          {data.sessions} sessions by {data.people} people · {formatTokens(data.budget.tokens)} tokens
        </p>
        {!current && (
          <p className="o2-notice">
            {data.analysis === "stale"
              ? "Sessions changed after the last analysis, so initiatives are hidden until it runs again. Sessions and tokens are current."
              : "These sessions have no analysis yet, so work is shown by project. Transcripts are available."}
          </p>
        )}
      </section>

      <section className="o2-section" aria-label="Initiatives">
        <h2 className="o2-h">{current ? "Initiatives" : "Projects"}</h2>
        {current ? (
          <div className="o2-table" role="list">
            <div className="o2-table__head" aria-hidden="true">
              <span>Initiative</span>
              <span>Health</span>
              <span>People</span>
              <span className="o2-num">Tokens</span>
              <span className="o2-num">Updated</span>
            </div>
            {data.initiatives.map((item) => (
              <button
                key={item.id}
                type="button"
                role="listitem"
                data-slot="o2-row"
                className="o2-row"
                aria-pressed={pick?.kind === "initiative" && pick.id === item.id}
                onClick={() => onPick({ kind: "initiative", id: item.id })}
              >
                <span className="o2-row__main">
                  <span className="o2-row__name">{item.name}</span>
                  <span className="o2-row__update">{item.update}</span>
                </span>
                <span>
                  <Health value={item.health} />
                </span>
                <Avatars people={item.people} />
                <span className="o2-num">{formatTokens(item.tokens)}</span>
                <span className="o2-num o2-muted">{ago(item.lastTs, fixtureClock)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="o2-table" role="list">
            {data.projects.map((project) => (
              <div key={project.name} role="listitem" className="o2-row o2-row--static">
                <span className="o2-row__main">
                  <span className="o2-row__name">{project.name}</span>
                  <span className="o2-row__update">{project.sessions.length} sessions</span>
                </span>
                <span />
                <Avatars people={[...new Map(project.sessions.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()]} />
                <span className="o2-num">{formatTokens(project.tokens)}</span>
                <span />
              </div>
            ))}
          </div>
        )}
      </section>

      <Tokens data={data} />

      {current && (data.stuck.length > 0 || data.improvements.length > 0) && (
        <section className="o2-section" aria-label="Worth a look">
          <h2 className="o2-h">Worth a look</h2>
          <div className="o2-cards">
            {data.stuck.map((item) => (
              <article key={item.id} className="o2-card">
                <span className="o2-kind" data-kind="blocker">Blocker</span>
                <p className="o2-card__title">{item.text}</p>
                <p className="o2-muted">Holding up {item.initiative}.</p>
                <Evidence ids={item.sessions} onPick={onPick} />
              </article>
            ))}
            {data.improvements.map((item) => (
              <article key={item.id} className="o2-card">
                <span className="o2-kind" data-kind="suggestion">Suggestion</span>
                <p className="o2-card__title">{item.suggestion}</p>
                <p className="o2-muted">{item.observation}</p>
                <Evidence ids={item.sessions} onPick={onPick} />
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="o2-foot">Initiatives, updates and suggestions are summarised from the team's sessions. Proposed – not part of today's API.</p>
    </>
  );
}

export function Health({ value }: { value: Initiative["health"] }) {
  return (
    <span className="o2-health" data-health={value}>
      <span className="o2-health__dot" aria-hidden="true" />
      {value === "at-risk" ? "At risk" : "On track"}
    </span>
  );
}

export function Avatars({ people }: { people: Person[] }) {
  return (
    <span className="o2-avatars" aria-label={people.map((p) => p.name).join(", ")}>
      {people.map((p) => (
        <span key={p.id} className="o2-avatar" title={p.name}>
          {p.name
            .split(" ")
            .map((part) => part[0])
            .join("")}
        </span>
      ))}
    </span>
  );
}

function Evidence({ ids, onPick }: { ids: string[]; onPick: (p: Pick) => void }) {
  return (
    <button type="button" data-slot="o2-link" className="o2-link" onClick={() => onPick({ kind: "session", id: ids[0]!, from: null })}>
      Based on {ids.length} {ids.length === 1 ? "session" : "sessions"} <ArrowUpRight size={13} aria-hidden="true" />
    </button>
  );
}

const SHADES = ["100%", "62%", "34%", "18%"];

function Tokens({ data }: { data: Overview }) {
  const [by, setBy] = useState<Dimension>("initiative");
  const rows =
    by === "person"
      ? data.budget.byPerson
      : by === "model"
        ? data.budget.byModel
        : data.initiatives.length
          ? data.initiatives.map((i) => ({ name: i.name, tokens: i.tokens ?? 0 }))
          : data.projects.map((p) => ({ name: p.name, tokens: p.tokens ?? 0 }));
  const total = rows.reduce((a, r) => a + r.tokens, 0) || 1;
  const color = (i: number) => `color-mix(in srgb, var(--ar-blue) ${SHADES[i % SHADES.length]}, var(--aui-surface))`;
  return (
    <section className="o2-section" aria-label="Tokens">
      <div className="o2-split-head">
        <h2 className="o2-h">Where the tokens go</h2>
        <div className="o2-seg" role="tablist" aria-label="Break down by">
          {(["initiative", "person", "model"] as const).map((d) => (
            <button key={d} type="button" role="tab" data-slot="o2-seg" aria-selected={by === d} onClick={() => setBy(d)}>
              {d === "initiative" ? (data.initiatives.length ? "Initiative" : "Project") : d === "person" ? "Person" : "Model"}
            </button>
          ))}
        </div>
      </div>
      <div className="o2-tokens">
        <div className="o2-tokens__total">
          <span className="o2-big">{formatTokens(data.budget.tokens)}</span>
          <span className="o2-muted">tokens · cost not reported yet</span>
        </div>
        <div className="o2-stack" aria-hidden="true">
          {rows.map((r, i) => (
            <span key={r.name} style={{ flexGrow: r.tokens, background: color(i) }} />
          ))}
        </div>
        <ul className="o2-legend">
          {rows.map((r, i) => (
            <li key={r.name}>
              <span className="o2-legend__dot" style={{ background: color(i) }} />
              <span className="o2-legend__name">{r.name}</span>
              <span className="o2-num">{formatTokens(r.tokens)}</span>
              <span className="o2-num o2-muted">{Math.round((r.tokens / total) * 100)}%</span>
            </li>
          ))}
        </ul>
        {data.budget.tokenSessions < data.sessions && (
          <p className="o2-muted o2-small">
            Only {data.budget.tokenSessions} of {data.sessions} sessions report tokens, so the real total is higher.
          </p>
        )}
      </div>
    </section>
  );
}

export const INITIATIVE_TABS = ["Overview", "Prompts", "Sessions"] as const;
export const SESSION_TABS = ["Summary", "Details"] as const;

/** An initiative in the panel, one tab at a time: Overview (update + facts), Prompts, Sessions */
export function InitiativePanel({ item, tab = "Overview", onSession }: { item: Initiative; tab?: string; onSession: (id: string) => void }) {
  return (
    <div className="o2-detail">
      <header className="o2-detail__head">
        <Health value={item.health} />
        <h2>{item.name}</h2>
        {tab === "Overview" && item.goal && <p className="o2-muted">{item.goal}</p>}
      </header>
      {tab === "Overview" && (
        <>
          <div className="o2-update">
            <span className="o2-label">Latest update · {ago(item.lastTs, fixtureClock)}</span>
            <p>{item.update}</p>
          </div>
          <dl className="o2-props">
            <dt>People</dt>
            <dd>{item.people.map((p) => p.name).join(", ")}</dd>
            <dt>Sessions</dt>
            <dd>{item.sessions.length}</dd>
            <dt>Tokens</dt>
            <dd>{formatTokens(item.tokens)}</dd>
          </dl>
        </>
      )}
      {tab === "Prompts" && (
        <div className="o2-block">
          <span className="o2-label">What people asked their agents</span>
          <ul className="o2-quotes">
            {[...new Map(item.sessions.map((s) => [s.prompt, s])).values()].map((s) => (
              <li key={s.id}>
                <p>“{s.prompt}”</p>
                <span className="o2-muted o2-small">{s.person?.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "Sessions" && (
        <div className="o2-block">
          <span className="o2-label">{item.sessions.length} sessions</span>
          <ul className="o2-sessions">
            {item.sessions.map((s) => (
              <li key={s.id}>
                <button type="button" data-slot="o2-session" className="o2-session" onClick={() => onSession(s.id)}>
                  <span>{s.title}</span>
                  <span className="o2-muted o2-small">
                    {s.person?.name} · {formatTokens(s.tokens)} tokens
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A session in the panel: Summary (asked + result) and Details (usage, machine, transcript) */
export function SessionPanel({ item, tab = "Summary", back, onBack }: { item: SessionItem; tab?: string; back: Initiative | null; onBack: (id: string) => void }) {
  return (
    <div className="o2-detail">
      {back && (
        <button type="button" data-slot="o2-back" className="o2-back" onClick={() => onBack(back.id)}>
          <ChevronLeft size={14} aria-hidden="true" /> {back.name}
        </button>
      )}
      <header className="o2-detail__head">
        <h2>{item.title}</h2>
        <p className="o2-muted">
          {item.person?.name} · {item.agent} · {item.status === "finished" ? "Finished" : "Working"}
        </p>
      </header>
      {tab === "Summary" ? (
        <>
          <div className="o2-block">
            <span className="o2-label">Asked</span>
            <p>“{item.prompt}”</p>
          </div>
          <div className="o2-block">
            <span className="o2-label">Result</span>
            <p>{item.result}</p>
          </div>
        </>
      ) : (
        <>
          <dl className="o2-props">
            <dt>Tokens</dt>
            <dd>{item.tokens === null ? "Not recorded" : formatTokens(item.tokens)}</dd>
            <dt>Agent</dt>
            <dd>{item.agent}</dd>
            <dt>Machine</dt>
            <dd>{item.machine}</dd>
          </dl>
          <button type="button" data-slot="o2-open" className="o2-open" onClick={() => openTranscript(item.id)}>
            Open transcript <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
