"use client";

import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { AgentRecap, type RecapEvent } from "../../registry/agent-recap/component.clean";
import { AgentFleet, type FleetAgent } from "../../registry/agent-fleet/component.clean";
import { AgentInbox, type AgentTask } from "../../registry/agent-inbox/component.clean";

/*
 * Mission Control (clean) – all agents at a glance, built from affectUI components.
 *   · Agent Recap as a summary strip on top: what happened since you looked, as counts and an activity curve
 *   · Agent Fleet in the middle: who runs under whom
 *   · Agent Inbox on the side, as the list of what needs you
 *   · one filter – running, needs you, failed – picks agents, and all three parts show only them
 *   · a dot on the chart points at its agent: it stays in the fleet and the inbox, the rest fades
 * One `agents` list feeds all of it; the three components install with it.
 * The styles are injected below, so no extra files are needed.
 */

export type MissionStatus = "queued" | "running" | "waiting" | "done" | "failed";

export type MissionAgent = {
  id: string;
  name: string;
  model?: string;
  /** A small mark, e.g. the model maker's logo */
  avatar?: ReactNode;
  /** The person it works for: their name and photo – in the agent table and as a tag on its card */
  owner?: { name: string; face?: ReactNode };
  status: MissionStatus;
  /** What it works on now */
  task: string;
  /** A waiting agent: what it asks you */
  ask?: string;
  /** A failed agent: what went wrong */
  error?: string;
  cost?: number;
  /** Epoch ms */
  started?: number;
  ended?: number;
  tools?: ReactNode[];
  /** Agents it started */
  children?: MissionAgent[];
};

/** Something an agent did while you were away – `agent` is the id it belongs to */
export type MissionEvent = RecapEvent & { agent: string };

export type MissionFilter = "all" | "running" | "waiting" | "failed";

export type MissionControlProps = {
  agents: MissionAgent[];
  events?: MissionEvent[];
  /** When you last looked – the strip on top starts here */
  since: number;
  now?: number;
  /** Controlled filter */
  filter?: MissionFilter;
  defaultFilter?: MissionFilter;
  onFilterChange?: (filter: MissionFilter) => void;
  onApprove?: (agent: MissionAgent) => void;
  onReject?: (agent: MissionAgent) => void;
  onRetry?: (agent: MissionAgent) => void;
  /** Dismiss for a failed agent, from its card in the middle – it then counts as done */
  onDismiss?: (agent: MissionAgent) => void;
  title?: string;
  /** Controls at the right end of the filter row – e.g. the period the page looks at */
  actions?: ReactNode;
  /** The chart's title – e.g. "Last 7 days" when the page looks at another period */
  recapTitle?: string;
  className?: string;
};

const FILTERS: { id: MissionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "waiting", label: "Needs you" },
  { id: "failed", label: "Failed" },
];

/** "Needs you" is everything waiting on you: an agent that asks, and one that failed and waits for a retry */
const matches = (a: MissionAgent, filter: MissionFilter) => filter === "all" || a.status === filter || (filter === "waiting" && a.status === "failed");
/** Where the card's tag isn't beside it – the table, the inbox – the person goes in front of the agent's name */
const fullName = (a: MissionAgent) => (a.owner ? `${a.owner.name} · ${a.name}` : a.name);
const walk = (a: MissionAgent): MissionAgent[] => [a, ...(a.children ?? []).flatMap(walk)];
/** An agent shows when it matches – or when one of its sub-agents does, so the way to it stays */
const keep = (a: MissionAgent, filter: MissionFilter): MissionAgent | null => {
  const kids = (a.children ?? []).map((k) => keep(k, filter)).filter((k): k is MissionAgent => !!k);
  return matches(a, filter) || kids.length ? { ...a, children: kids } : null;
};

/** An answer from any part – the inbox, the middle – changes the agent everywhere at once */
type Answer = "approve" | "reject" | "retry" | "dismiss";
const AFTER: Record<Answer, MissionStatus> = { approve: "running", reject: "failed", retry: "running", dismiss: "done" };
/** As on the fleet's cards: cents below $10, whole dollars above, never "$0.00" */
const money = (n: number) => (n < 0.01 ? "<$0.01" : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);

export function MissionControl({
  agents: given,
  events: givenEvents = [],
  since,
  now,
  filter,
  defaultFilter = "all",
  onFilterChange,
  onApprove,
  onReject,
  onRetry,
  onDismiss,
  title = "Mission control",
  recapTitle = "Since you looked",
  actions,
  className,
}: MissionControlProps) {
  const [innerFilter, setInnerFilter] = useState(defaultFilter);
  const picked = filter ?? innerFilter;
  const pick = (f: MissionFilter) => {
    setInnerFilter(f);
    onFilterChange?.(f);
  };

  // Under "All" the finished agents wait behind one row – this opens it
  const [showDone, setShowDone] = useState(false);

  // A dot on the chart points at its agent: it stays in the middle and in the inbox, the rest fades
  const [pointed, setPointed] = useState<string | null>(null);
  // A row in the agent table beside the chart: its agent's dots stay, the rest fade – as hovering a harness on the sessions page
  const [rowLead, setRowLead] = useState<string | null>(null);

  // Answers made here hold until the agent's status changes in your data – so an answer shows at once, and your
  // update (or none, without handlers) takes over from there
  const [answers, setAnswers] = useState<Record<string, { from: MissionStatus; to: MissionStatus }>>({});
  const apply = (a: MissionAgent): MissionAgent => {
    const done = answers[a.id];
    const status = done && done.from === a.status ? done.to : a.status;
    const changed = status !== a.status;
    return {
      ...a,
      status,
      ask: status === "waiting" ? a.ask : undefined,
      error: status === "failed" ? (changed ? "You rejected the request" : a.error) : undefined,
      children: a.children?.map(apply),
    };
  };
  const agents = given.map(apply);
  const rawById = new Map(given.flatMap(walk).map((a) => [a.id, a]));
  const answer = (id: string, action: Answer) => {
    const a = rawById.get(id);
    if (!a) return;
    setAnswers((all) => ({ ...all, [id]: { from: a.status, to: AFTER[action] } }));
    ({ approve: onApprove, reject: onReject, retry: onRetry, dismiss: onDismiss })[action]?.(a);
  };
  // What was answered drops out of "needs you" on the curve too
  const settledIds = new Set(Object.keys(answers).filter((id) => agents.flatMap(walk).some((a) => a.id === id && a.status !== "waiting" && a.status !== "failed")));
  const events = givenEvents.map((e) => (settledIds.has(e.agent) && (e.kind === "needs" || e.kind === "failed") ? { ...e, kind: "done" as const } : e));

  const everyone = agents.flatMap(walk);
  const count = (f: MissionFilter) => everyone.filter((a) => matches(a, f)).length;
  // The filter is one tab stop: the arrows pick the next one that has agents, Home and End the ends
  const filterRef = useRef<HTMLDivElement>(null);
  const onFilterKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const open = FILTERS.filter((f) => f.id === "all" || count(f.id) > 0);
    const at = open.findIndex((f) => f.id === picked);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? open.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = open[(to + open.length) % open.length];
    pick(next.id);
    filterRef.current?.querySelector<HTMLButtonElement>(`[data-kind="${next.id}"]`)?.focus();
  };

  const shown = agents.map((a) => keep(a, picked)).filter((a): a is MissionAgent => !!a);
  const ids = new Set(shown.flatMap(walk).filter((a) => matches(a, picked)).map((a) => a.id));

  // Under "All" the middle shows each agent once on the page: only what is at work gets a card. A branch that
  // only waits for you is already in the inbox and isn't repeated here; a finished one folds into one row.
  const atWork = (a: MissionAgent) => walk(a).some((x) => x.status === "running" || x.status === "queued");
  const stuck = (a: MissionAgent) => walk(a).some((x) => x.status === "waiting" || x.status === "failed");
  const split = picked === "all";
  const working = split ? shown.filter(atWork) : shown;
  const finished = split ? shown.filter((a) => !atWork(a) && !stuck(a)) : [];
  const byId = new Map(everyone.map((a) => [a.id, a]));

  // The middle
  const toFleet = (a: MissionAgent): FleetAgent => ({
    id: a.id,
    name: a.name,
    task: a.task,
    model: a.model,
    avatar: a.avatar,
    owner: a.owner,
    tools: a.tools,
    status: a.status,
    ask: a.ask,
    error: a.error,
    cost: a.cost,
    started: a.started,
    ended: a.ended,
    children: a.children?.map(toFleet),
  });

  // The side: what needs you – an agent waiting for an answer or one that failed
  const needs: AgentTask[] = everyone
    .filter((a) => ids.has(a.id) && (a.status === "waiting" || a.status === "failed"))
    .map((a) => ({
      id: a.id,
      title: a.task,
      description: a.ask ?? a.error,
      agent: a.status === "waiting" ? `Asked by ${fullName(a)}` : `Stopped in ${fullName(a)}`,
      // The same words with faces: the person's photo before their name, the harness logo before the agent
      agentLine: (
        <span className="ui-mcc__asked">
          <span>{a.status === "waiting" ? "Asked by" : "Stopped in"}</span>
          {a.owner && (
            <>
              {a.owner.face && <span className="ui-mcc__asked-mark" aria-hidden="true">{a.owner.face}</span>}
              <span className="ui-mcc__asked-name">{a.owner.name}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          {a.avatar && <span className="ui-mcc__asked-mark" data-logo="" aria-hidden="true">{a.avatar}</span>}
          <span className="ui-mcc__asked-name">{a.name}</span>
        </span>
      ),
      status: a.status === "waiting" ? "waiting" : "failed",
      startedAt: a.started,
    }));
  const agentOf = (t: AgentTask) => byId.get(t.id)!;

  // Beside the chart: one row per main agent – what its branch did since you looked, and what the branch cost
  const leadOf = new Map(agents.flatMap((lead) => walk(lead).map((a) => [a.id, lead.id] as const)));
  const seenEvents = events.filter((e) => ids.has(e.agent));
  const rows = shown
    .map((lead) => {
      const mine = seenEvents.filter((e) => leadOf.get(e.agent) === lead.id);
      const n = (k: MissionEvent["kind"]) => mine.filter((e) => e.kind === k).length;
      return { lead, done: n("done"), needs: n("needs"), failed: n("failed"), total: mine.length, cost: walk(lead).reduce((sum, a) => sum + (a.cost ?? 0), 0) };
    })
    .sort((a, b) => b.total - a.total || b.cost - a.cost);
  const ROWS = 5;
  const activeLead = rowLead ?? (pointed ? leadOf.get(pointed) ?? null : null);

  return (
    <section className={["ui-mcc", className].filter(Boolean).join(" ")} aria-label={title}>
      <style href="ui-mission-control-clean" precedence="default">
        {css}
      </style>
      <header className="ui-mcc__bar">
        {/* One filter for all three parts – it opens the page in the title's place; the title stays the section's name */}
        <div ref={filterRef} className="ui-mcc__filter" role="radiogroup" aria-label="Show agents" onKeyDown={onFilterKey}>
          {FILTERS.map((f) => {
            const n = count(f.id);
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={picked === f.id}
                tabIndex={picked === f.id ? 0 : -1}
                className="ui-mcc__chip"
                data-kind={f.id}
                disabled={n === 0 && f.id !== "all"}
                onClick={() => pick(f.id)}
              >
                {f.id !== "all" && <span aria-hidden="true" className="ui-mcc__dot" data-kind={f.id} />}
                {f.label}
                <span className="ui-mcc__n">{n}</span>
              </button>
            );
          })}
        </div>
        {actions && <div className="ui-mcc__actions">{actions}</div>}
      </header>

      {/* The chart and, beside it, who did what – one card, as the chart and the harness table on the sessions page */}
      <div className="ui-mcc__recap">
        <AgentRecap
          events={seenEvents}
          since={since}
          until={now}
          board={false}
          counts={false}
          title={recapTitle}
          replay={0}
          onHover={(e) => setPointed(e ? (e as MissionEvent).agent : null)}
          focus={rowLead ? (e) => leadOf.get((e as MissionEvent).agent) === rowLead : null}
        />
        <div className="ui-mcc__by">
          <table className="ui-mcc__table" aria-label={`By agent: ${recapTitle}`}>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col" className="ui-mcc__num">Done</th>
                <th scope="col" className="ui-mcc__num">Needs you</th>
                <th scope="col" className="ui-mcc__num">Failed</th>
                <th scope="col" className="ui-mcc__num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, ROWS).map(({ lead, done, needs: asks, failed, cost }) => (
                <tr
                  key={lead.id}
                  data-dim={(activeLead && activeLead !== lead.id) || undefined}
                  onPointerEnter={() => {
                    setRowLead(lead.id);
                    setPointed(lead.id);
                  }}
                  onPointerLeave={() => {
                    setRowLead(null);
                    setPointed(null);
                  }}
                >
                  <td>
                    <span className="ui-mcc__who">
                      <span className="ui-mcc__mark" aria-hidden="true">{lead.avatar}</span>
                      <span className="ui-mcc__name" title={fullName(lead)}>{lead.name}</span>
                      {lead.owner && (
                        <span className="ui-mcc__owner" title={`Works for ${lead.owner.name}`}>
                          {lead.owner.face && (
                            <span className="ui-mcc__owner-face" aria-hidden="true">
                              {lead.owner.face}
                            </span>
                          )}
                          <span className="ui-mcc__owner-name">{lead.owner.name}</span>
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="ui-mcc__num">{done || <span className="ui-mcc__zero">–</span>}</td>
                  <td className="ui-mcc__num" data-kind={asks ? "needs" : undefined}>{asks || <span className="ui-mcc__zero">–</span>}</td>
                  <td className="ui-mcc__num" data-kind={failed ? "failed" : undefined}>{failed || <span className="ui-mcc__zero">–</span>}</td>
                  <td className="ui-mcc__num">{cost ? money(cost) : <span className="ui-mcc__zero">–</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="ui-mcc__none">No agents</td>
                </tr>
              )}
            </tbody>
          </table>
          {rows.length > ROWS && <p className="ui-mcc__more">{rows.length - ROWS} more below</p>}
        </div>
      </div>

      <div className="ui-mcc__grid">
        <div className="ui-mcc__main">
          <div className="ui-mcc__panel">
            <AgentFleet
              key={picked}
              agents={working.map(toFleet)}
              now={now}
              title={split ? "At work now" : "Agents"}
              highlight={pointed}
              onResolve={(a, action) => answer(a.id, action)}
            />
            {finished.length > 0 && (
              <div className="ui-mcc__folds">
                <div className="ui-mcc__fold" data-kind="done">
                  <span className="ui-mcc__fold-text">
                    <b>{finished.length}</b> done
                  </span>
                  <button type="button" className="ui-mcc__fold-btn" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                    {showDone ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}
            {/* The finished agents open under their row – a fleet of their own, without a second title */}
            {showDone && finished.length > 0 && (
              <AgentFleet
                className="ui-mcc__done"
                agents={finished.map(toFleet)}
                defaultOpen={null}
                now={now}
                title="Done"
                highlight={pointed}
                onResolve={(a, action) => answer(a.id, action)}
              />
            )}
          </div>
        </div>
        <aside className="ui-mcc__side">
          <AgentInbox
            tasks={needs}
            view="list"
            lanes={["needs"]}
            highlight={pointed && needs.some((t) => t.id === pointed) ? pointed : null}
            title="Inbox"
            onApprove={(t) => answer(agentOf(t).id, "approve")}
            onReject={(t) => answer(agentOf(t).id, "reject")}
            onRetry={(t) => answer(agentOf(t).id, "retry")}
          />
        </aside>
      </div>
    </section>
  );
}

const css = /* css */ `
.ui-mcc {
  --ui-mcc-ink: var(--aui-ink, rgba(32, 40, 46, 0.88));
  --ui-mcc-text: var(--aui-muted, rgba(32, 40, 46, 0.61));
  --ui-mcc-muted: var(--aui-muted, rgba(32, 40, 46, 0.45));
  --ui-mcc-track: var(--aui-subtle, rgba(29, 79, 122, 0.05));
  --ui-mcc-card: #ffffff;
  --ui-mcc-panel: var(--aui-surface, #ffffff);
  --ui-mcc-shadow: 0 0 0 0.5px rgba(29, 79, 122, 0.08), 0 1px 2px 0 rgba(29, 79, 122, 0.06);
  --ui-mcc-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-mcc-stroke: var(--aui-shadow-card, 0 0 0 1px rgba(29, 79, 122, 0.08), 0 1px 2px 0 rgba(29, 79, 122, 0.05));
  /* One gap between all parts – down and across */
  --ui-mcc-gap: 16px;
  /* The fleet's own width (312 + 48 + 272) and the white card's padding around it */
  --ui-mcc-fleet-w: 664px;
  --ui-mcc-line: var(--aui-border, rgba(29, 79, 122, 0.06));
  box-sizing: border-box;
  display: grid;
  gap: var(--ui-mcc-gap);
  width: 100%;
  min-width: 0;
  /* Named, so the queries below ask the block's width – not that of a component inside it */
  container: ui-mcc / inline-size;
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-mcc-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-mcc *, .ui-mcc *::before, .ui-mcc *::after { box-sizing: border-box; }
.ui-mcc__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-width: 0; }
/* The page's own controls at the row's right end, on the same line as the filter */
.ui-mcc__actions { display: flex; align-items: center; margin-left: auto; min-width: 0; }
/* The filter: tabs as on the sessions table – no track, only the picked one is filled */
.ui-mcc__filter { display: flex; gap: 4px; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.ui-mcc__filter::-webkit-scrollbar { display: none; }
.ui-mcc__chip { flex: none; display: inline-flex; align-items: center; gap: 6px; height: var(--control-h, 32px); margin: 0; padding: 0 10px; border: 0; border-radius: var(--radius-md, var(--aui-radius, 8px)); background: transparent; font: inherit; font-size: 13px; font-weight: 400; color: var(--muted-foreground, var(--ui-mcc-text)); white-space: nowrap; cursor: pointer; transition: background-color 140ms ease, color 140ms ease; -webkit-tap-highlight-color: transparent; }
.ui-mcc__chip:hover:not(:disabled) { background: var(--hover, var(--accent, var(--ui-mcc-track))); color: var(--foreground, var(--ui-mcc-ink)); }
.ui-mcc__chip[aria-checked="true"] { background: var(--select, var(--accent, var(--ui-mcc-track))); color: var(--foreground, var(--ui-mcc-ink)); font-weight: 500; }
.ui-mcc__chip:disabled { opacity: 0.45; cursor: default; }
.ui-mcc__chip:focus-visible { outline: 2px solid var(--ring, var(--ui-mcc-focus)); outline-offset: -2px; }
.ui-mcc__n { font-size: 12px; line-height: 18px; font-weight: 400; font-variant-numeric: tabular-nums; color: var(--faint, var(--muted-foreground, var(--ui-mcc-muted))); }
/* A dot in the status color, as on the sessions tabs – the colors of the status pills on the agent cards */
.ui-mcc__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--d); }
.ui-mcc__dot[data-kind="running"] { --d: var(--status-info, #0070d6); }
/* Orange as on the "needs you" tag – the theme's warning red-brown is too close to the failed red on light */
.ui-mcc__dot[data-kind="waiting"] { --d: #f28a2e; }
.ui-mcc__dot[data-kind="failed"] { --d: var(--status-danger, #f04438); }

/* The chart as on the sessions page: taller, a soft fill under the line, no hour lines – two dashed level lines and a solid base
   in the border color, a 2px line, and the times in the same 12px muted text as the dates there */
.ui-mcc .ui-rcp__chart { height: 180px; margin-top: 16px; }
.ui-mcc .ui-rcp { --ui-rcp-area: color-mix(in srgb, var(--muted-foreground, #6b7280) 24%, transparent); }
.ui-mcc .ui-rcp__grid line { stroke: var(--border, var(--ui-rcp-grid)); stroke-dasharray: 4 4; opacity: 0.7; }
.ui-mcc .ui-rcp__grid line[data-hour], .ui-mcc .ui-rcp__grid line[data-level="0.25"], .ui-mcc .ui-rcp__grid line[data-level="0.75"] { display: none; }
.ui-mcc .ui-rcp__frame { border-top: 1px dashed color-mix(in srgb, var(--border, #e8e8e8) 70%, transparent); border-bottom-color: var(--border, var(--ui-rcp-grid)); }
.ui-mcc .ui-rcp__line { stroke: var(--muted-foreground, var(--ui-rcp-stroke)); stroke-width: 2; }
.ui-mcc .ui-rcp__ends { margin-top: 8px; color: var(--muted-foreground, var(--ui-rcp-faint)); }
/* The chart and the agent table in one card, the table behind a hairline – as on the sessions page */
/* The divider sits where the inbox starts below, so both rows share one line */
.ui-mcc__recap { display: grid; grid-template-columns: minmax(0, calc(var(--ui-mcc-fleet-w) + var(--ui-mcc-gap))) minmax(0, 1fr); min-width: 0; overflow: hidden; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-mcc-panel); box-shadow: var(--ui-mcc-stroke); }
.ui-mcc .ui-mcc__recap .ui-rcp { border-radius: 0; background: transparent; box-shadow: none; }
.ui-mcc__by { display: flex; flex-direction: column; min-width: 0; border-left: 1px solid var(--border, var(--ui-mcc-line)); }
.ui-mcc__table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
.ui-mcc__table th:nth-child(n + 2) { width: 52px; }
.ui-mcc__table th:nth-child(3) { width: 76px; }
.ui-mcc__table th:last-child { width: 68px; }
.ui-mcc__table th { height: 40px; padding: 0 8px; border-bottom: 1px solid var(--border, var(--ui-mcc-line)); font-size: 12px; font-weight: 500; color: var(--muted-foreground, var(--ui-mcc-text)); text-align: left; white-space: nowrap; }
.ui-mcc__table td { height: 40px; padding: 0 8px; overflow: hidden; border-bottom: 1px solid var(--border, var(--ui-mcc-line)); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; color: var(--foreground, var(--ui-mcc-ink)); }
.ui-mcc__table th:first-child, .ui-mcc__table td:first-child { padding-left: 16px; }
.ui-mcc__table th:last-child, .ui-mcc__table td:last-child { padding-right: 16px; }
.ui-mcc__table tbody tr:last-child td { border-bottom: 0; }
.ui-mcc__table tbody tr { transition: opacity 140ms ease, background-color 140ms ease; }
.ui-mcc__table tbody tr:hover { background: var(--hover, var(--accent, var(--ui-mcc-track))); }
.ui-mcc__table tbody tr[data-dim] { opacity: 0.55; }
.ui-mcc__table .ui-mcc__num { text-align: right; }
.ui-mcc__table td.ui-mcc__num { font-weight: 500; }
.ui-mcc__table td[data-kind="needs"] { color: #e07a1f; }
.ui-mcc__table td[data-kind="failed"] { color: var(--status-danger, #f04438); }
.ui-mcc__zero { font-weight: 400; color: var(--faint, var(--muted-foreground, var(--ui-mcc-muted))); }
.ui-mcc__who { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-mcc__mark { display: grid; flex: none; place-items: center; width: 16px; height: 16px; }
.ui-mcc__mark > * { max-width: 100%; max-height: 100%; }
.ui-mcc__name { flex: 0 0 auto; max-width: 60%; min-width: 0; overflow: hidden; font-weight: 500; text-overflow: ellipsis; }
/* Whose agent it is – the same quiet tag as at the bottom of its card */
.ui-mcc__owner { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 0; height: 20px; padding: 0 6px 0 2px; border-radius: 999px; background: var(--ui-agfc-fill, var(--ui-mcc-track)); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--muted-foreground, var(--ui-mcc-text)); }
.ui-mcc__owner-face { display: grid; flex: none; place-items: center; width: 16px; height: 16px; overflow: hidden; border-radius: 50%; font-size: 10px; }
.ui-mcc__owner-face > * { width: 100% !important; height: 100% !important; }
.ui-mcc__owner-face * { font-size: inherit !important; }
.ui-mcc__owner-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-mcc__none { color: var(--muted-foreground, var(--ui-mcc-text)); }
.ui-mcc__more { margin: 0; padding: 8px 16px; border-top: 1px solid var(--border, var(--ui-mcc-line)); font-size: 12px; line-height: 16px; color: var(--muted-foreground, var(--ui-mcc-text)); }
/* The fleet and the inbox in one card too, split where the chart and the table above are – the inbox behind a hairline */
.ui-mcc .ui-mcc__grid { grid-template-columns: minmax(0, calc(var(--ui-mcc-fleet-w) + var(--ui-mcc-gap))) minmax(0, 1fr); gap: 0; overflow: hidden; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-mcc-panel); box-shadow: var(--ui-mcc-stroke); }
.ui-mcc .ui-mcc__panel { border-radius: 0; background: transparent; box-shadow: none; }
.ui-mcc .ui-mcc__side { border-left: 1px solid var(--border, var(--ui-mcc-line)); }
/* The inbox's head becomes a title row like the fleet's beside it, under the same hairline – its gray lane stays, under the head */
.ui-mcc__side .ui-aic__lane { padding: 0 16px 16px; border-radius: 0; background: transparent; }
.ui-mcc .ui-mcc__side .ui-aic__cards { margin: 0; padding: 4px; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-aic-lane); }
.ui-mcc__side .ui-aic__lane-head { height: auto; margin: 0 -16px 16px; padding: 14px 16px; border-bottom: 0.5px solid var(--ui-mcc-line); }
/* The fleet keeps its own width – wider cards than on its own – and the inbox takes the rest right beside it */
.ui-mcc__grid { display: grid; grid-template-columns: minmax(0, var(--ui-mcc-fleet-w)) minmax(0, 1fr); align-items: start; gap: var(--ui-mcc-gap); min-width: 0; }
.ui-mcc .ui-agfc { --ui-agfc-main-w: 312px; --ui-agfc-card-w: 272px; --ui-agfc-gap: 48px; }
/* The fleet on a white card: its title row on top under a hairline, the agents below */
.ui-mcc__panel { height: 100%; padding: 0 16px 16px; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-mcc-panel); box-shadow: var(--ui-mcc-stroke); }
.ui-mcc__panel .ui-agfc__bar { margin: 0 -16px 16px; padding: 14px 16px; border-bottom: 0.5px solid var(--ui-mcc-line); }
/* An open inbox card: who it's from and the answer in one quiet gray row, instead of a section under a hairline */
.ui-mcc__side .ui-aic__more { display: flex; align-items: center; gap: 10px; margin: 0 10px 10px; padding: 6px 6px 6px 10px; border: 0; border-radius: var(--aui-radius, 8px); background: var(--ui-mcc-track); }
.ui-mcc__side .ui-aic__agent { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-mcc__side .ui-aic__actions { flex: none; margin-top: 0; }
.ui-mcc__side .ui-aic__btn { height: 26px; padding: 0 10px; font-size: 12px; }
/* The inbox without its title row – its gray lane says what it holds – so it starts and ends with the card beside it */
.ui-mcc__side .ui-aic__bar { display: none; }
.ui-mcc__main, .ui-mcc__side { min-width: 0; }
/* Both columns end together: the row takes the taller of the two – with only the agents at work in the middle,
   that is often the inbox – and the shorter one stretches to it */
.ui-mcc__grid { align-items: stretch; }
.ui-mcc__side { position: relative; min-height: 240px; display: flex; flex-direction: column; }
.ui-mcc__side > .ui-aic { flex: 1; display: flex; flex-direction: column; }
/* The agents that aren't at work, each kind folded into one quiet row under the cards */
.ui-mcc__folds { display: grid; gap: 4px; margin-top: 12px; }
.ui-mcc__fold { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 4px 4px 12px; border-radius: var(--aui-radius, 8px); background: var(--ui-mcc-track); font-size: 12px; line-height: 16px; color: var(--ui-mcc-text); }
.ui-mcc__fold::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--d, var(--ui-mcc-muted)); }
.ui-mcc__fold[data-kind="done"] { --d: var(--status-success, #1e8a4f); }
.ui-mcc__fold-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-mcc__fold-text b { font-weight: 500; color: var(--ui-mcc-ink); font-variant-numeric: tabular-nums; }
.ui-mcc__fold-btn { flex: none; height: 28px; margin: 0; padding: 0 10px; border: 0; border-radius: var(--aui-radius-sm, 6px); background: none; font: inherit; font-size: 12px; font-weight: 500; color: var(--ui-mcc-ink); cursor: pointer; transition: background-color 140ms ease; }
.ui-mcc__fold-btn:hover { background: var(--hover, var(--accent, var(--ui-mcc-track))); }
.ui-mcc__done { margin-top: 12px; }
.ui-mcc__panel .ui-mcc__done .ui-agfc__bar { display: none; }
.ui-mcc__fold-btn:focus-visible { outline: 2px solid var(--ring, var(--ui-mcc-focus)); outline-offset: -2px; }
.ui-mcc__side .ui-aic__lanes { flex: 1; grid-template-rows: minmax(0, 1fr); align-items: stretch; min-height: 0; }
.ui-mcc__side .ui-aic__lane { display: flex; flex-direction: column; min-height: 0; }
.ui-mcc__side .ui-aic__cards { flex: 1; align-content: start; min-height: 0; margin: -1px; padding: 1px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }

/* ----- One type scale across all parts ----- */
/* As on the sessions page: section titles 14px, card titles and body 13px, everything under them 12px;
   weights 400 and 500 only */
.ui-mcc :is(.ui-rcp__title, .ui-aic__heading, .ui-agfc__title) { font-size: 14px; line-height: 20px; font-weight: 500; }
.ui-mcc .ui-aic__title { font-size: 13px; line-height: 20px; }
/* Line heights as on the sessions page too: 13px text on 20px, 12px text on 16px */
.ui-mcc .ui-agfc__name { line-height: 20px; }
.ui-mcc .ui-agfc__model { line-height: 16px; }
.ui-mcc .ui-aic__desc { font-size: 12px; line-height: 16px; }
.ui-mcc .ui-aic__foot { font-size: 12px; line-height: 16px; margin-top: 2px; }
.ui-mcc :is(.ui-aic__time, .ui-aic__state-word) { font-size: 12px; }
/* Corners as on the sessions page: 12px for the outer surfaces (summary, agents card, inbox),
   8px for a card inside them, 6px for small buttons and tags */
.ui-mcc :is(.ui-agfc__main, .ui-aic__card, .ui-aic__card-main) { border-radius: var(--radius-md, 8px); }
.ui-mcc .ui-aic__btn { border-radius: var(--radius-sm, 6px); }
/* Inbox cards as compact as the agent cards beside them */
.ui-mcc .ui-aic__cards { gap: 4px; }
.ui-mcc .ui-aic__card-main { gap: 2px; padding: 8px 10px; }
.ui-mcc .ui-aic__foot { margin-top: 2px; }
/* An inbox card, closed or open: what it's about, and top right how long it has waited (or "Failed").
   Closed, the subtitle – the question or the error – takes up to two lines; a click opens all of it
   and the answers, while the state stays where it was. */
.ui-mcc__side .ui-aic__card-main { grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 8px; }
.ui-mcc__side .ui-aic__card[data-open] .ui-aic__card-main { align-items: start; }
.ui-mcc__side .ui-aic__title-row { grid-column: 1; grid-row: 1; }
.ui-mcc__side .ui-aic__foot { grid-column: 2; grid-row: 1; margin-top: 0; padding-left: 0; }
.ui-mcc__side .ui-aic__card[data-open] .ui-aic__foot { height: 20px; }
.ui-mcc__side .ui-aic__desc { grid-column: 1 / -1; grid-row: 2; color: var(--muted-foreground, var(--ui-mcc-text)); }
.ui-mcc__side .ui-aic__card:not([data-open]) .ui-aic__desc { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-mcc__side .ui-aic__state:not([data-bare]) .ui-aic__state-word { display: none; }
/* "Asked by [photo] Marco · [logo] Migrator" in the open card */
.ui-mcc__asked { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.ui-mcc__asked-mark { display: grid; flex: none; place-items: center; width: 16px; height: 16px; overflow: hidden; border-radius: 50%; margin-left: 2px; }
.ui-mcc__asked-mark > * { width: 100% !important; height: 100% !important; }
.ui-mcc__asked-mark[data-logo] { overflow: visible; border-radius: 0; }
.ui-mcc__asked-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-mcc__side .ui-aic__card:not([data-open]) .ui-aic__title { display: block; white-space: nowrap; text-overflow: ellipsis; }

/* The summary strip gets the same clear hairline as the fleet's card: its own half pixel fades away when the block is scaled */
.ui-mcc .ui-rcp { box-shadow: var(--ui-mcc-stroke); }
/* Narrow: the table moves under the chart, as on the sessions page */
@container ui-mcc (max-width: 900px) {
  .ui-mcc__recap { grid-template-columns: minmax(0, 1fr); }
  .ui-mcc__by { border-top: 1px solid var(--border, var(--ui-mcc-line)); border-left: 0; }
}
@container ui-mcc (max-width: 860px) {
  .ui-mcc .ui-mcc__grid { grid-template-columns: minmax(0, 1fr); }
  .ui-mcc .ui-mcc__side { border-top: 1px solid var(--border, var(--ui-mcc-line)); border-left: 0; }
  /* Stacked, the inbox takes the height it needs */
  .ui-mcc__side { min-height: 0; }
  .ui-mcc__side > .ui-aic { position: static; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-mcc__chip { transition: none; }
}
:where(.dark, [data-theme="dark"]) .ui-mcc {
  --ui-mcc-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-mcc-text: var(--aui-muted, rgba(255, 255, 255, 0.62));
  --ui-mcc-muted: var(--aui-muted, rgba(255, 255, 255, 0.45));
  --ui-mcc-track: var(--aui-subtle, rgba(255, 255, 255, 0.07));
  --ui-mcc-card: #2a2a2e;
  --ui-mcc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(32, 40, 46, 0.4);
  --ui-mcc-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-mcc-stroke: var(--aui-shadow-card, 0 0 0 1px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(32, 40, 46, 0.4));
  --ui-mcc-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-mcc-panel: var(--aui-surface, #1c1c1f);
}
`;
