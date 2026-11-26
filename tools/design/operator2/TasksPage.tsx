// Tasks: everything in flight, in one calm table – what it is and where it stands, whether it's on track,
// when it last moved and what it costs. That's the bottom line Khaliq asked for; people, tokens and
// sessions are on each task's own page. Sortable by the column heads (Updated, Cost). A row opens the
// task's page.
//
// One health signal per task: it is at risk when it is blocked, or when two agents on it touched the same
// work without talking (an overlap the operator should act on). The status line says which.
import { useState } from "react";
import { ArrowDown, FolderOpen, Layers, ListTodo } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, type Initiative, type Overview, type SessionItem } from "../operator/model";
import type { Overlap } from "../operator/overlaps";
import type { Go } from "./App";
import { costOfAll, formatUSD } from "./cost";
import { PageHead } from "./PageHead";
import { shippedOf } from "./outcomes";

type Sort = "updated" | "cost";
type Task = { id: string; name: string; item: Initiative | null; sessions: SessionItem[]; lastTs: string | null };

export const overlapsOf = (data: Overview, task: { name: string; sessions: SessionItem[] }) => {
  const ids = new Set(task.sessions.map((s) => s.id));
  return data.overlaps.filter((o) => o.initiative === task.name || o.sides.some((s) => ids.has(s.id)));
};
/** Overlaps on a task where the agents didn't talk – the ones that put it at risk */
export const blindOverlapsOf = (data: Overview, task: { name: string; sessions: SessionItem[] }): Overlap[] =>
  overlapsOf(data, task).filter((o) => o.communication === "not_observed");

export type TaskHealth = "on-track" | "look" | "at-risk";

/**
 * The task's health, three steps: at risk when it's blocked (or reported so); needs a look when its agents
 * collided without talking – worth a word, but the work isn't stuck; on track otherwise. Overlaps alone
 * used to count as at risk, which made nearly every task red and the column meaningless.
 */
export function healthOf(data: Overview, task: Initiative): TaskHealth {
  if (task.health === "at-risk" || task.blocker) return "at-risk";
  return blindOverlapsOf(data, task).length ? "look" : "on-track";
}

const HEALTH_LABEL: Record<TaskHealth, string> = { "on-track": "On track", look: "Needs a look", "at-risk": "At risk" };

export function Health({ value }: { value: TaskHealth }) {
  return (
    <span className="o2-health" data-health={value}>
      <span className="o2-health__dot" aria-hidden="true" />
      {HEALTH_LABEL[value]}
    </span>
  );
}

const sentence = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1).replace(/\.$/, "")}`;

/** Where the task stands, in one line: the blocker, else the overlap, else the latest update */
export function statusOf(data: Overview, task: Initiative): { text: string; risk: boolean } {
  if (task.blocker) return { text: `Blocked: ${sentence(task.blocker)}`, risk: true };
  const blind = blindOverlapsOf(data, task);
  if (blind.length) return { text: `Overlap: ${sentence(blind[0]!.title)} – the agents didn't talk`, risk: false };
  return { text: task.update.replace(/\.$/, ""), risk: false };
}

function tasksOf(data: Overview): Task[] {
  if (data.initiatives.length) return data.initiatives.map((i) => ({ id: i.id, name: i.name, item: i, sessions: i.sessions, lastTs: i.lastTs }));
  // No current analysis: the projects stand in, without health or a written update
  return data.projects.map((p) => ({ id: p.name, name: p.name, item: null, sessions: p.sessions, lastTs: p.sessions.map((s) => s.lastTs).sort().at(-1) ?? null }));
}

/** The table's first row: all tasks together, in the same columns */
function Summary({ data, rows }: { data: Overview; rows: Task[] }) {
  const all = rows.flatMap((t) => t.sessions);
  const atRisk = rows.filter((t) => t.item && healthOf(data, t.item) === "at-risk").length;
  const look = rows.filter((t) => t.item && healthOf(data, t.item) === "look").length;
  const done = rows.reduce((a, t) => (t.item ? a + shippedOf(t.item).shipped : a), 0);
  const made = rows.reduce((a, t) => (t.item ? a + shippedOf(t.item).of : a), 0);
  const noun = data.initiatives.length ? "task" : "project";
  const latest = rows.map((t) => t.lastTs ?? "").sort().at(-1) || null;
  return (
    <div className="v2-table__row v2-table__row--summary" role="row">
      <span className="v2-task" role="cell">
        <Layers size={16} aria-hidden="true" className="v2-task__icon" />
        <span className="v2-task__text">
          <span className="v2-task__name">
            All {rows.length} {rows.length === 1 ? noun : `${noun}s`}
          </span>
        </span>
      </span>
      <span role="cell" className="o2-muted">
        {atRisk || look ? (
          <span className="v2-health-sum">
            {atRisk > 0 && (
              <span className="o2-health" data-health="at-risk">
                <span className="o2-health__dot" aria-hidden="true" />
                {atRisk} at risk
              </span>
            )}
            {look > 0 && (
              <span className="o2-health" data-health="look">
                <span className="o2-health__dot" aria-hidden="true" />
                {look} to look at
              </span>
            )}
          </span>
        ) : data.initiatives.length ? (
          "All on track"
        ) : (
          "–"
        )}
      </span>
      <span role="cell" className="v2-num o2-num o2-muted">
        {made ? `${done} of ${made}` : "–"}
      </span>
      <span role="cell" className="v2-num o2-muted">
        {ago(latest, fixtureClock)}
      </span>
      <span role="cell" className="v2-num o2-num">
        {formatUSD(costOfAll(all))}
      </span>
    </div>
  );
}

export function TasksPage({ data, go }: { data: Overview; go: Go }) {
  const [sort, setSort] = useState<Sort>("updated");
  const rows = tasksOf(data).sort((a, b) =>
    sort === "cost" ? (costOfAll(b.sessions) ?? 0) - (costOfAll(a.sessions) ?? 0) : Date.parse(b.lastTs ?? "0") - Date.parse(a.lastTs ?? "0"),
  );
  const head = (id: Sort, label: string) => (
    <button type="button" data-slot="v2-sort" className="v2-sort" aria-pressed={sort === id} onClick={() => setSort(id)}>
      {label}
      {sort === id && <ArrowDown size={12} aria-hidden="true" />}
    </button>
  );

  return (
    <>
      <PageHead title="Tasks" sub="What the team's agents are moving forward, and what each costs." />
      <section className="v2-section" aria-label="Tasks">
        <div className="v2-table v2-tasks" role="table">
          {rows.length > 0 && (
            <div className="v2-table__head" role="row">
              <span role="columnheader">Task</span>
              <span role="columnheader">Health</span>
              <span role="columnheader" className="v2-num" title="Pull requests, documents and reviews that are out – plans not counted">
                Shipped
              </span>
              <span role="columnheader" className="v2-num">
                {head("updated", "Last activity")}
              </span>
              <span role="columnheader" className="v2-num">
                {head("cost", "Cost est.")}
              </span>
            </div>
          )}
          {rows.length > 0 && <Summary data={data} rows={rows} />}
          {rows.length === 0 && (
            <div className="v2-empty" role="row">
              <ListTodo size={20} aria-hidden="true" />
              <b>No tasks in flight</b>
              <span>Once people start working with their agents, what they're moving forward shows up here.</span>
            </div>
          )}
          {rows.map((t) => {
            const status = t.item ? statusOf(data, t.item) : { text: `${t.sessions.length} sessions`, risk: false };
            const cells = (
              <>
                <span className="v2-task" role="cell">
                  <FolderOpen size={16} aria-hidden="true" className="v2-task__icon" />
                  <span className="v2-task__text">
                    <span className="v2-task__name">{t.name}</span>
                    <span className="v2-task__line" data-blocked={status.risk ? "" : undefined}>
                      {status.text}
                    </span>
                  </span>
                </span>
                <span role="cell">{t.item ? <Health value={healthOf(data, t.item)} /> : <span className="o2-muted">–</span>}</span>
                <span role="cell" className="v2-num o2-num">
                  {t.item && shippedOf(t.item).of ? (
                    <>
                      {shippedOf(t.item).shipped} <span className="o2-muted">of {shippedOf(t.item).of}</span>
                    </>
                  ) : (
                    <span className="o2-muted">–</span>
                  )}
                </span>
                <span role="cell" className="v2-num o2-muted">
                  {ago(t.lastTs, fixtureClock)}
                </span>
                <span role="cell" className="v2-num o2-num">
                  {formatUSD(costOfAll(t.sessions))}
                </span>
              </>
            );
            return t.item ? (
              <button key={t.id} type="button" role="row" data-slot="v2-row" className="v2-table__row" onClick={() => go({ page: "task", id: t.id })}>
                {cells}
              </button>
            ) : (
              <div key={t.id} role="row" className="v2-table__row v2-table__row--static">
                {cells}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
