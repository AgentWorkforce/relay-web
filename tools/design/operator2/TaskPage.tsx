// One task on its own page – linkable, no tabs, no side panel. Top to bottom: what it is and where it
// stands (the summary of its sessions' summaries, the blocker, the next step), what came out of it (PRs
// merged or open, what's still running, what has no result), the facts in one row, what each model cost
// and delivered, who works on it, where it collides with other work, then its sessions. Each session shows
// its net result at a glance – summary, outcome, tokens, cost – and opens in place for what it produced,
// who ran it with which agent and model, and a way into the whole session. The prompts and tool calls stay
// in the session itself: the operator wants what came out, not how (Khaliq, 25 Nov).
import {
  ArrowLeft,
  ArrowRight,
  CircleDot,
  ClipboardCheck,
  CirclePause,
  FileText,
  Flag,
  GitMerge,
  GitPullRequest,
  Lightbulb,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { fixtureClock } from "../scenarios";
import {
  ago,
  formatTokens,
  type Overview,
  type SessionItem,
} from "../operator/model";
import { CategoryTag } from "../operator/OverlapPanel";
import { Initials } from "../operator/WeekPanel";
import type { Go } from "./App";
import { costOf, formatUSD } from "./cost";
import { Health, healthOf, overlapsOf } from "./TasksPage";
import { artifactOf, outcomeOf, shortName, STATE_LABEL, type Artifact } from "./outcomes";
import { SessionLink } from "./SessionLink";
import { Results } from "./TaskSplit";
import { CostTab } from "./CostTab";


/** The icon for an artifact: merged or open PR, document, review, Claude artifact */
export function ArtifactIcon(a: Artifact) {
  if (a.kind === "pr") return a.state === "merged" ? GitMerge : GitPullRequest;
  if (a.kind === "doc") return FileText;
  if (a.kind === "review") return ClipboardCheck;
  return Sparkles;
}

/** A session's net result as a small tag: the PR it produced, that it's still working, or no result yet */
export function OutcomeTag({ s }: { s: SessionItem }) {
  const outcome = outcomeOf(s);
  const a = artifactOf(s);
  const [Icon, label] =
    outcome === "running"
      ? [CircleDot, "Working"]
      : a && outcome !== "none"
        ? [ArtifactIcon(a), `${shortName(a)} ${STATE_LABEL[a.state].toLowerCase()}`]
        : [CirclePause, a?.state === "closed" ? `${shortName(a)} closed` : "No result"];
  return (
    <span className="v2-state" data-outcome={outcome}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

export function SessionItemRow({ s, go }: { s: SessionItem; go: Go }) {
  // One place for a session's details – its own page. In the list a session is one line: who, what,
  // what it worked on (the artifact tag), tokens and cost; the whole line opens the session.
  return (
    <li className="v2-session">
      <SessionLink id={s.id} go={go} slot="v2-session" className="v2-session__head" title="Open the session">
        <span className="v2-session__who">{s.person && <Initials name={s.person.name} />}</span>
        <span className="v2-session__main">
          <span className="v2-session__title">{s.title}</span>
          <span className="v2-session__summary">{s.summary ?? "No summary yet"}</span>
        </span>
        <OutcomeTag s={s} />
        <span className="v2-session__figure o2-num">{formatTokens(s.tokens)}</span>
        <span className="v2-session__figure o2-num">{formatUSD(costOf(s))}</span>
        <ArrowRight size={14} aria-hidden="true" className="v2-session__chev" />
      </SessionLink>
    </li>
  );
}

export function TaskPage({
  data,
  id,
  go,
}: {
  data: Overview;
  id: string;
  go: Go;
}) {
  const task = data.initiatives.find((i) => i.id === id);
  if (!task)
    return (
      <div className="o2-empty">
        <h2>This task isn't in the current period</h2>
        <p>
          <button
            type="button"
            data-slot="v2-back"
            className="v2-back"
            onClick={() => go({ page: "tasks" })}
          >
            <ArrowLeft size={14} aria-hidden="true" /> All tasks
          </button>
        </p>
      </div>
    );
  const sessions = [...task.sessions].sort((a, b) => {
    // What's running first, then the newest
    const r = Number(b.status === "active") - Number(a.status === "active");
    return r || Date.parse(b.lastTs) - Date.parse(a.lastTs);
  });
  const overlaps = overlapsOf(data, task);
  const helps = data.improvements.filter((i) =>
    i.sessions.some((sid) => task.sessions.some((s) => s.id === sid)),
  );

  return (
    <>
      {/* What it is, who works on it, when it last moved */}
      <header className="v2-page-head">
        <div className="v2-page-head__title">
          <h2>{task.name}</h2>
          <Health value={healthOf(data, task)} />
        </div>
        {task.goal && <p className="v2-page-head__goal">{task.goal}</p>}
        <p className="v2-page-head__meta">
          {task.people.length ? (
            <span className="v2-inline">
              {task.people.map((p) => (
                <Initials key={p.id} name={p.name} />
              ))}
              {task.people.map((p) => p.name).join(", ")}
            </span>
          ) : (
            <span>No one has worked on it yet</span>
          )}
          {task.lastTs && (
            <span>
              Last activity {ago(task.lastTs, fixtureClock).toLowerCase()}
            </span>
          )}
        </p>
      </header>

      {/* Where it stands: the progress, then what blocks it and what's next – each said once */}
      <section className="v2-section" aria-label="Where it stands">
        <h3 className="v2-h">Where it stands</h3>
        <p className="v2-text">{task.progress.replace(/\.?$/, ".")}</p>
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
      </section>

      {overlaps.length > 0 && (
        <section className="v2-section" aria-label="Overlaps">
          <h3 className="v2-h">Overlaps with other work</h3>
          <ul className="v2-list">
            {overlaps.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  data-slot="v2-row"
                  className="v2-list__row"
                  onClick={() => go({ page: "overlap", id: o.id })}
                >
                  <CategoryTag category={o.category} />
                  <span className="v2-list__title">{o.title}</span>
                  <span className="o2-muted">
                    {ago(o.detectedAt, fixtureClock)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The same content as the v2 layout's tabs, as sections one under the other */}
      <Results task={task} go={go} />
      {task.sessions.length > 0 && <CostTab task={task} days={data.period.days} go={go} />}

      <section className="v2-section" aria-label="Sessions">
        <div className="v2-section__head">
          <h3 className="v2-h">
            Sessions <span className="v2-h__total">{task.sessions.length}</span>
          </h3>
          <span className="v2-cols" aria-hidden="true">
            <span>Tokens</span>
            <span>Cost est.</span>
          </span>
        </div>
        {task.sessions.length === 0 && (
          <p className="v2-none">No sessions in this period.</p>
        )}
        <ul className="v2-sessions">
          {sessions.map((s) => (
            <SessionItemRow key={s.id} s={s} go={go} />
          ))}
        </ul>
      </section>

    </>
  );
}
