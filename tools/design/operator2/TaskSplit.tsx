// Task page, layout v2 – modelled on Interfere's issue view: everything that describes the task stays in a
// column on the left (what it is, its facts, where it stands, what it collides with, what it costs), and the
// right side shows one of three views, switched by the buttons on top:
//   Results  – what came out of it: every artifact (PRs, documents, reviews, Claude artifacts) with the sessions behind it
//   Sessions – every session with its result (PR merged / open, working, no result), opening in place
//   Cost     – cost over time (click a bar for its sessions), and by model or by person
// No activity feed: it repeated the sessions as events, and the operator wants the bottom line, not a stream.
import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleDot,
  CirclePause,
  PackageCheck,
  Clock,
  Coins,
  Flag,
  FolderOpen,
  GitMerge,
  Lightbulb,
  ListChecks,
  MessagesSquare,
  TriangleAlert,
  Cpu,
} from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, type Initiative, type Overview, type SessionItem } from "../operator/model";
import { CategoryTag } from "../operator/OverlapPanel";
import { Initials } from "../operator/WeekPanel";
import type { Go } from "./App";
import { costOf, costOfAll, formatUSD, modelOf } from "./cost";
import { actionOf, artifactCounts, artifactOf, artifactsOf, KIND_LABEL, outcomeOf, shippedOf, shortName, STATE_LABEL, type Artifact } from "./outcomes";
import { SessionLink } from "./SessionLink";
import { OutcomesBar } from "./OutcomesBar";
import { ArtifactIcon, SessionItemRow } from "./TaskPage";
import { CostTab } from "./CostTab";
import { useUrlChoice, useUrlValue } from "./urlState";
import { Health, healthOf, overlapsOf } from "./TasksPage";

type Tab = "results" | "sessions" | "cost";
const TABS: { id: Tab; label: string }[] = [
  { id: "results", label: "Results" },
  { id: "sessions", label: "Sessions" },
  { id: "cost", label: "Cost" },
];


/* ---------- Left column ---------- */

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Summary({ data, task, go }: { data: Overview; task: Initiative; go: Go }) {
  const overlaps = overlapsOf(data, task);
  const models = new Set(task.sessions.map((s) => modelOf(s).name)).size;
  const helps = data.improvements.filter((i) => i.sessions.some((sid) => task.sessions.some((s) => s.id === sid)));
  return (
    <aside className="v2s-left" aria-label="About this task">
      <div className="v2s-intro">
        <span className="v2s-icon" aria-hidden="true">
          <FolderOpen size={24} />
        </span>
        <span className="v2s-kicker">Task</span>
        <h2 className="v2s-title">{task.name}</h2>
        {task.goal && <p className="v2s-goal">{task.goal}</p>}
      </div>

      <dl className="v2s-props">
        <Prop label="Health">
          <Health value={healthOf(data, task)} />
        </Prop>
        <Prop label="Status">
          <span className="v2-inline">
            <ListChecks size={14} aria-hidden="true" /> {task.status}
          </span>
        </Prop>
        <Prop label="People">
          {task.people.length ? (
            <span className="v2s-stack">
              {task.people.map((p) => (
                <span key={p.id} className="v2-inline">
                  <Initials name={p.name} /> {p.name}
                </span>
              ))}
            </span>
          ) : (
            <span className="o2-muted">No one yet</span>
          )}
        </Prop>
        <Prop label="Last activity">
          <span className="v2-inline">
            <Clock size={14} aria-hidden="true" /> {task.lastTs ? ago(task.lastTs, fixtureClock) : "–"}
          </span>
        </Prop>
      </dl>

      <div className="v2s-block">
        <span className="v2s-label">Where it stands</span>
        <p className="v2s-text">{task.progress.replace(/\.?$/, ".")}</p>
        {task.blocker && (
          <p className="v2-callout" data-tone="risk">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              <b>Blocked</b> {task.blocker}
            </span>
          </p>
        )}
        <p className="v2-callout">
          <Flag size={16} aria-hidden="true" />
          <span>
            <b>Next</b> {task.nextStep}
          </span>
        </p>
        {helps.map((i) => (
          <p key={i.id} className="v2-callout" data-tone="idea">
            <Lightbulb size={16} aria-hidden="true" />
            <span>
              <b>{i.suggestion}</b> {i.observation}
            </span>
          </p>
        ))}
      </div>

      <dl className="v2s-props">
        <Prop label="Sessions">
          <span className="v2-inline">
            <MessagesSquare size={14} aria-hidden="true" /> {task.sessions.length}
          </span>
        </Prop>
        <Prop label="Shipped">
          <span className="v2-inline">
            <GitMerge size={14} aria-hidden="true" /> {shippedOf(task).shipped} of {shippedOf(task).of}
          </span>
        </Prop>
        <Prop label="Models">
          <span className="v2-inline">
            <Cpu size={14} aria-hidden="true" /> {models}
          </span>
        </Prop>
        {overlaps.length > 0 && (
          <Prop label="Overlaps">
            <span className="v2s-stack">
              {overlaps.map((o) => (
                <button key={o.id} type="button" data-slot="v2-link" className="v2s-overlap" onClick={() => go({ page: "overlap", id: o.id })}>
                  <CategoryTag category={o.category} />
                  <span>{o.title}</span>
                </button>
              ))}
            </span>
          </Prop>
        )}
      </dl>

    </aside>
  );
}

/* ---------- Right: Sessions and Cost ---------- */

function Sessions({ task, go }: { task: Initiative; go: Go }) {
  const sessions = [...task.sessions].sort((a, b) => {
    const r = Number(b.status === "active") - Number(a.status === "active");
    return r || Date.parse(b.lastTs) - Date.parse(a.lastTs);
  });
  if (!sessions.length) return <p className="v2-none">No sessions in this period.</p>;
  return (
    <>
      <div className="v2-section__head">
        <span className="o2-muted">{sessions.length} sessions</span>
        <span className="v2-cols" aria-hidden="true">
          <span>Tokens</span>
          <span>Cost est.</span>
        </span>
      </div>
      <ul className="v2-sessions">
        {sessions.map((s) => (
          <SessionItemRow key={s.id} s={s} go={go} />
        ))}
      </ul>
    </>
  );
}

/** What the task produced: the split by result, then every artifact – today the pull requests – each
 *  opening the session that made it. Khaliq: "what did the prompts generate and what happened from them". */
/** A session under "Still running" or "No result": what it is, who ran it, when */
function ResultRow({ s, go }: { s: SessionItem; go: Go }) {
  const outcome = outcomeOf(s);
  const a = artifactOf(s);
  return (
    <li>
      <SessionLink id={s.id} go={go} slot="v2-result" className="v2-result" title="Open the session">
        <span className="v2-result__icon" data-state={outcome} aria-hidden="true">
          {outcome === "running" ? <CircleDot size={16} /> : <CirclePause size={16} />}
        </span>
        <span className="v2-result__main">
          <span className="v2-result__title">{s.title}</span>
          <span className="v2-result__meta">
            {s.person && (
              <span className="v2-inline">
                <Initials name={s.person.name} /> {s.person.name}
              </span>
            )}
            {a && outcome === "running" && <span>working on {a.kind === "pr" ? `PR #${a.number}` : a.title}</span>}
            {a && a.state === "closed" && <span>{shortName(a)} closed</span>}
            <span>{ago(s.lastTs, fixtureClock)}</span>
          </span>
        </span>
        <span className="v2-state" data-outcome={outcome}>
          {outcome === "running" ? "Running" : "No result"}
        </span>
        <ArrowRight size={14} aria-hidden="true" className="v2-result__go" />
      </SessionLink>
    </li>
  );
}

/**
 * One thing the task produced. The row says what it is, whether it's out, who worked on it, how many
 * sessions it took (more than one means rework: review rounds, fixes) and what those cost. It opens in
 * place to the sessions behind it – each with what it did to the artifact – and, for a PR, to the PR.
 */
function ArtifactRow({ a, go, open, onToggle }: { a: Artifact; go: Go; open: boolean; onToggle: () => void }) {
  // Opened from a link: bring it into view
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const Icon = ArtifactIcon(a);
  const people = [...new Map(a.sessions.filter((s) => s.person).map((s) => [s.person!.id, s.person!])).values()];
  const last = a.sessions.at(-1)!;
  return (
    <li ref={ref} className="v2-art" data-open={open || undefined}>
      <button type="button" data-slot="v2-art" className="v2-result v2-art__head" aria-expanded={open} onClick={onToggle}>
        <span className="v2-result__icon" data-state={a.state} aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="v2-result__main">
          <span className="v2-result__title">
            {a.kind === "pr" && <span className="o2-num v2-result__n">#{a.number}</span>} {a.title}
          </span>
          <span className="v2-result__meta">
            <span>{KIND_LABEL[a.kind]}</span>
            <span className="v2-inline v2-art__people">
              {people.map((p) => (
                <Initials key={p.id} name={p.name} />
              ))}
              {people.length === 1 && people[0]!.name}
            </span>
            <span>{a.sessions.length === 1 ? "1 session" : `${a.sessions.length} sessions`}</span>
            <span className="o2-num">{formatUSD(costOfAll(a.sessions))}</span>
            <span>{ago(last.lastTs, fixtureClock)}</span>
          </span>
        </span>
        <span className="v2-state" data-art={a.state}>
          {STATE_LABEL[a.state]}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="v2-art__chev" />
      </button>
      {open && (
        <div className="v2-art__body">
          <ol className="v2-art__sessions">
            {a.sessions.map((s) => (
              <li key={s.id}>
                <SessionLink id={s.id} go={go} slot="v2-link" className="v2-art__session">
                  {s.person ? <Initials name={s.person.name} /> : <span className="v2-feed__dot" />}
                  <span className="v2-art__what">
                    {s.person?.name ?? "Someone"} {actionOf(a, s)}
                  </span>
                  <span className="o2-muted">{ago(s.lastTs, fixtureClock)}</span>
                  <span className="o2-num o2-muted">{formatUSD(costOf(s))}</span>
                  <ArrowRight size={14} aria-hidden="true" className="v2-result__go" />
                </SessionLink>
              </li>
            ))}
          </ol>
          {a.kind === "pr" && (
            <a href={`https://github.com/northstar/edge-service/pull/${a.number}`} target="_blank" rel="noreferrer" data-slot="v2-link" className="v2-link v2-session__open">
              Open pull request #{a.number} on GitHub <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

/** What the task produced: the split by result, then every artifact, then what's still running and what
 *  ended without a result. */
export function Results({ task, go }: { task: Initiative; go: Go }) {
  if (!task.sessions.length) return <p className="v2-none">Nothing yet – results show up here once agents work on it.</p>;
  // The bar counts artifacts – the same things the list under it shows
  const counts = artifactCounts(task);
  // One artifact open at a time, kept in the link
  const [openId, setOpenId] = useUrlValue("artifact");
  const newest = (a: SessionItem, b: SessionItem) => Date.parse(b.lastTs) - Date.parse(a.lastTs);
  const made = artifactsOf(task);
  const running = task.sessions.filter((s) => outcomeOf(s) === "running").sort(newest);
  const none = task.sessions.filter((s) => outcomeOf(s) === "none").sort(newest);
  const part = (label: string, list: SessionItem[]) =>
    list.length > 0 && (
      <section className="v2-section" aria-label={label}>
        <h3 className="v2-h">
          {label} <span className="v2-h__total">{list.length}</span>
        </h3>
        <ul className="v2-results">
          {list.map((s) => (
            <ResultRow key={s.id} s={s} go={go} />
          ))}
        </ul>
      </section>
    );
  return (
    <>
      <section className="v2-section" aria-label="What came out of it">
        <h3 className="v2-h">What came out of it</h3>
        <OutcomesBar counts={counts} />
      </section>
      <section className="v2-section" aria-label="Artifacts">
        <h3 className="v2-h">
          Artifacts <span className="v2-h__total">{made.length}</span>
        </h3>
        {made.length ? (
          <ul className="v2-results">
            {made.map((a) => (
              <ArtifactRow key={a.id} a={a} go={go} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
            ))}
          </ul>
        ) : (
          <p className="v2-none">Nothing produced yet.</p>
        )}
      </section>
      {part("Still running", running)}
      {part("No result", none)}
    </>
  );
}

/* ---------- The page ---------- */

export function TaskSplit({ data, id, go }: { data: Overview; id: string; go: Go }) {
  const [tab, setTab] = useUrlChoice<Tab>("tab", ["results", "sessions", "cost"], "results");
  const task = data.initiatives.find((i) => i.id === id);
  if (!task)
    return (
      <div className="o2-empty">
        <h2>This task isn't in the current period</h2>
        <p>
          <button type="button" data-slot="v2-back" className="v2-back" onClick={() => go({ page: "tasks" })}>
            <ArrowLeft size={14} aria-hidden="true" /> All tasks
          </button>
        </p>
      </div>
    );
  return (
    <div className="v2s">
      <Summary data={data} task={task} go={go} />
      <section className="v2s-right" aria-label="Details">
        <div className="v2s-tabs" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" data-slot="v2s-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.id === "results" && <PackageCheck size={14} aria-hidden="true" />}
              {t.id === "cost" && <Coins size={14} aria-hidden="true" />}
              {t.label}
            </button>
          ))}
        </div>
        <div className="v2s-pane">
          {tab === "results" ? <Results task={task} go={go} /> : tab === "sessions" ? <Sessions task={task} go={go} /> : <CostTab task={task} days={data.period.days} go={go} />}
        </div>
      </section>
    </div>
  );
}
