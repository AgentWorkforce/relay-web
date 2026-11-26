// One session on its own page – the content of Agent Relay's session page (who, where, when, how long,
// the summary, the prompt, the tool calls, the agent's answer) in the v2 design. Laid out like the task
// page's v2 layout: what the session is and its facts on the left, and on the right what happened in it,
// as a timeline in the manner of Interfere's activity feed, and what it cost.
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Coins, MessagesSquare, SquareTerminal } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, formatTokens, type Overview, type SessionItem } from "../operator/model";
import { HARNESS_LABELS, HarnessLogo, Initials } from "../operator/WeekPanel";
import type { Go } from "./App";
import { costOf, formatUSD, modelOf, usageOf } from "./cost";
import { sessionHref } from "./data";
import { actionOf, artifactOf } from "./outcomes";
import { ArtifactIcon, OutcomeTag } from "./TaskPage";

type Tab = "conversation" | "cost";

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

const duration = (s: SessionItem) => {
  const min = Math.max(1, Math.round((Date.parse(s.lastTs) - Date.parse(s.firstTs)) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};

/* ---------- Left: what the session is ---------- */

function Summary({ s }: { s: SessionItem }) {
  const running = s.status === "active";
  return (
    <aside className="v2s-left" aria-label="About this session">

      <div className="v2s-intro">
        <span className="v2s-icon" aria-hidden="true">
          <MessagesSquare size={24} />
        </span>
        <span className="v2s-kicker">Session</span>
        <h2 className="v2s-title">{s.title}</h2>
        {s.summary && <p className="v2s-goal">{s.summary}</p>}
      </div>

      <dl className="v2s-props">
        <Prop label="Result">
          <OutcomeTag s={s} />
        </Prop>
        <Prop label="Person">
          {s.person ? (
            <span className="v2-inline">
              <Initials name={s.person.name} /> {s.person.name}
            </span>
          ) : (
            <span className="o2-muted">Unknown</span>
          )}
        </Prop>
        <Prop label="Agent">
          <span className="v2-inline">
            <HarnessLogo source={s.source} /> {HARNESS_LABELS[s.source] ?? s.source} · @{s.agent}
          </span>
        </Prop>
        <Prop label="Model">
          <span className="v2-inline v2s-plain-logo">
            <HarnessLogo source={modelOf(s).icon} /> {modelOf(s).name}
          </span>
        </Prop>
        <Prop label="Machine">{s.machine ?? <span className="o2-muted">Unknown</span>}</Prop>
      </dl>

      <dl className="v2s-props">
        <Prop label="Started">{ago(s.firstTs, fixtureClock)}</Prop>
        <Prop label={running ? "Running for" : "Took"}>{duration(s)}</Prop>
        <Prop label="Last activity">{ago(s.lastTs, fixtureClock)}</Prop>
      </dl>

      <div className="v2s-figure">
        <span className="v2s-label">Cost est.</span>
        <span className="v2s-figure__value">{formatUSD(costOf(s))}</span>
        <span className="o2-muted">{s.tokens === null ? "Tokens not recorded" : `${formatTokens(s.tokens)} tokens`}</span>
      </div>

      <a href={sessionHref(s)} target="_blank" rel="noreferrer" data-slot="v2-link" className="v2-link v2-session__open">
        Open in Agent Relay <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </aside>
  );
}

/* ---------- Right: what happened ---------- */

function Step({ icon, head, time, children }: { icon: ReactNode; head: ReactNode; time: string; children?: ReactNode }) {
  return (
    <li className="v2-feed__item">
      <span className="v2-feed__mark" aria-hidden="true">
        {icon}
      </span>
      <div className="v2-feed__body">
        <p className="v2-feed__head">
          {head} <span className="v2-feed__time">· {time}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * The session as it went: the person's request, what the agent ran, what it answered, what it produced.
 * The data records the first prompt, one tool call and the final answer; a real session has many turns
 * of each, and this feed would list them the same way.
 */
function Conversation({ s }: { s: SessionItem }) {
  const a = artifactOf(s);
  const agent = HARNESS_LABELS[s.source] ?? s.source;
  const turns = usageOf(s);
  const mid = new Date((Date.parse(s.firstTs) + Date.parse(s.lastTs)) / 2).toISOString();
  return (
    <ol className="v2-feed">
      <Step icon={s.person ? <Initials name={s.person.name} /> : <span className="v2-feed__dot" />} head={<><b>{s.person?.name ?? "Someone"}</b> asked</>} time={ago(s.firstTs, fixtureClock)}>
        <p className="v2-feed__text">{s.prompt}</p>
      </Step>
      <Step icon={<SquareTerminal size={14} />} head={<><b>{agent}</b> ran a command</>} time={ago(mid, fixtureClock)}>
        <div className="v2-code">
          <div className="v2-code__head">
            <SquareTerminal size={14} aria-hidden="true" /> npm test
          </div>
          <pre className="v2-code__body">{"Process exited with code 0\nFocused tests passed."}</pre>
        </div>
      </Step>
      <Step icon={<HarnessLogo source={s.source} />} head={<><b>{agent}</b> answered</>} time={ago(s.lastTs, fixtureClock)}>
        <p className="v2-feed__text">{s.result}</p>
      </Step>
      {a && (
        <Step
          icon={(() => {
            const Icon = ArtifactIcon(a);
            return <Icon size={14} />;
          })()}
          head={<>{(() => { const t = actionOf(a, s); return t.charAt(0).toUpperCase() + t.slice(1); })()}</>}
          time={ago(s.lastTs, fixtureClock)}
        />
      )}
      {s.status === "active" && (
        <li className="v2-feed__item v2-feed__item--live">
          <span className="v2-feed__mark" aria-hidden="true">
            <span className="v2-feed__pulse" />
          </span>
          <div className="v2-feed__body">
            <p className="v2-feed__head">Still working…</p>
          </div>
        </li>
      )}
      <li className="v2-feed__note o2-muted">
        {turns.length} turns of work in all – the full transcript with every prompt and tool call is in Agent Relay.
      </li>
    </ol>
  );
}

function SessionCost({ s }: { s: SessionItem }) {
  const turns = usageOf(s);
  if (!turns.length) return <p className="v2-none">No tokens recorded for this session.</p>;
  const byModel = [...new Set(turns.map((u) => u.model.name))]
    .map((name) => {
      const list = turns.filter((u) => u.model.name === name);
      return { name, icon: list[0]!.model.icon, tokens: list.reduce((x, u) => x + u.tokens, 0), cost: list.reduce((x, u) => x + u.cost, 0) };
    })
    .sort((x, y) => y.cost - x.cost);
  const max = Math.max(0.0001, ...byModel.map((m) => m.cost));
  const top = Math.max(...turns.map((u) => u.cost));
  return (
    <>
      <section className="v2-section" aria-label="Cost over the session">
        <h3 className="v2-h">Over the session</h3>
        <div className="v2-turns" aria-hidden="true">
          {[...new Set(turns.map((u) => u.t))].map((t) => {
            const at = turns.filter((u) => u.t === t);
            const c = at.reduce((x, u) => x + u.cost, 0);
            return <span key={t} style={{ height: `${Math.max(4, (c / top) * 100)}%` }} title={formatUSD(c)} />;
          })}
        </div>
        <div className="v2-spend__axis o2-muted" aria-hidden="true">
          <span>Start</span>
          <span>{s.status === "active" ? "Now" : "End"}</span>
        </div>
      </section>
      <section className="v2-section" aria-label="By model">
        <div className="v2-section__head">
          <h3 className="v2-h">
            By model <span className="v2-h__total">{byModel.length}</span>
          </h3>
          <span className="v2-cols v2-cols--two" aria-hidden="true">
            <span>Tokens</span>
            <span>Cost est.</span>
          </span>
        </div>
        <ul className="v2-models v2-models--two">
          {byModel.map((m) => (
            <li key={m.name}>
              <span className="v2-inline v2-models__name">
                <HarnessLogo source={m.icon} /> {m.name}
                {m.name !== modelOf(s).name && <span className="o2-muted">side work</span>}
              </span>
              <span className="v2-models__track" aria-hidden="true">
                <span style={{ width: `${(m.cost / max) * 100}%` }} />
              </span>
              <span className="o2-num v2-models__n">{formatTokens(Math.round(m.tokens))}</span>
              <span className="o2-num v2-models__n">{formatUSD(m.cost)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function SessionPage({ data, id, go }: { data: Overview; id: string; go: Go }) {
  const [tab, setTab] = useState<Tab>("conversation");
  const task = data.initiatives.find((i) => i.sessions.some((s) => s.id === id));
  const s = task?.sessions.find((x) => x.id === id);
  if (!s)
    return (
      <div className="o2-empty">
        <h2>This session isn't in the current period</h2>
        <p>
          <button type="button" data-slot="v2-back" className="v2-back" onClick={() => go({ page: "tasks" })}>
            <ArrowLeft size={14} aria-hidden="true" /> All tasks
          </button>
        </p>
      </div>
    );
  return (
    <div className="v2s">
      <Summary s={s} />
      <section className="v2s-right" aria-label="Details">
        <div className="v2s-tabs" role="tablist" aria-label="Show">
          <button type="button" role="tab" data-slot="v2s-tab" aria-selected={tab === "conversation"} onClick={() => setTab("conversation")}>
            <MessagesSquare size={14} aria-hidden="true" /> Conversation
          </button>
          <button type="button" role="tab" data-slot="v2s-tab" aria-selected={tab === "cost"} onClick={() => setTab("cost")}>
            <Coins size={14} aria-hidden="true" /> Cost
          </button>
        </div>
        <div className="v2s-pane">{tab === "conversation" ? <Conversation s={s} /> : <SessionCost s={s} />}</div>
      </section>
    </div>
  );
}
