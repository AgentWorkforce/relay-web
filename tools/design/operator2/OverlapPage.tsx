// One overlap on its own page – linkable, no tabs. What happened and what would help first, then the
// facts, both sides (each with its result), what both touched, and what each side recorded – so the
// operator can judge it and get the two people talking.
import { ArrowLeft, FileText, GitBranch, Lightbulb, ListTodo } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, formatTokens, type Overview } from "../operator/model";
import { CategoryTag, KindLabel } from "../operator/OverlapPanel";
import { HARNESS_LABELS, HarnessLogo, Initials } from "../operator/WeekPanel";
import type { Go } from "./App";
import { formatUSD } from "./cost";
import { Talked, twiceUSD } from "./OverlapsPage";

const ARTIFACT_ICONS = { file: FileText, branch: GitBranch, task: ListTodo } as const;

export function OverlapPage({ data, id, go }: { data: Overview; id: string; go: Go }) {
  const o = data.overlaps.find((x) => x.id === id);
  const back = (
    <button type="button" data-slot="v2-back" className="v2-back" onClick={() => go({ page: "overlaps" })}>
      <ArrowLeft size={14} aria-hidden="true" /> Overlaps
    </button>
  );
  if (!o)
    return (
      <div className="o2-empty">
        <h2>This overlap isn't in the current period</h2>
        <p>{back}</p>
      </div>
    );
  const task = o.initiative ? data.initiatives.find((i) => i.name === o.initiative) : undefined;

  return (
    <>
      <header className="v2-page-head">
        <CategoryTag category={o.category} />
        <div className="v2-page-head__title">
          <h2>{o.title}</h2>
        </div>
        <p className="v2-page-head__goal">{o.explanation}</p>
      </header>

      {o.suggestion && (
        <p className="v2-callout" data-tone="idea">
          <Lightbulb size={16} aria-hidden="true" />
          <span>
            <b>What would help</b> {o.suggestion}
          </span>
        </p>
      )}

      <dl className="v2-facts">
        <div>
          <dt>Kind</dt>
          <dd>
            <KindLabel item={o} />
          </dd>
        </div>
        <div>
          <dt>Task</dt>
          <dd>
            {task ? (
              <button type="button" data-slot="v2-link" className="v2-link" onClick={() => go({ page: "task", id: task.id })}>
                {task.name}
              </button>
            ) : (
              (o.initiative ?? "None")
            )}
          </dd>
        </div>
        <div>
          <dt>Talked?</dt>
          <dd>
            <Talked o={o} />
          </dd>
        </div>
        <div>
          <dt>Spent twice</dt>
          <dd>{o.duplicateTokens === null ? "Nothing" : `~${formatTokens(o.duplicateTokens)} · ${formatUSD(twiceUSD(o))} est.`}</dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>
            {ago(o.detectedAt, fixtureClock)} · {o.confidence} confidence
          </dd>
        </div>
      </dl>

      <section className="v2-section" aria-label="Both sides">
        <h3 className="v2-h">Both sides</h3>
        <div className="v2-sides">
          {o.sides.map((s) => (
            <article key={s.id} className="v2-side">
              <span className="v2-inline">
                {s.person && <Initials name={s.person.name} />}
                <b>{s.person?.name ?? "Unknown"}</b>
                <span className="o2-muted">
                  · <HarnessLogo source={s.source} /> {HARNESS_LABELS[s.source] ?? s.source}
                </span>
              </span>
              <span className="v2-side__title">{s.title}</span>
              <p className="v2-side__text">{s.summary ?? s.result}</p>
              <span className="o2-muted">{ago(s.lastTs, fixtureClock)}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="v2-section" aria-label="What both touched">
        <h3 className="v2-h">What both touched</h3>
        <ul className="v2-artifacts">
          {o.artifacts.map((a) => {
            const Icon = ARTIFACT_ICONS[a.type];
            return (
              <li key={a.value}>
                <Icon size={14} aria-hidden="true" />
                <span className={a.type === "task" ? undefined : "v2-mono"}>{a.value}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="v2-section" aria-label="What each side recorded">
        <h3 className="v2-h">What each side recorded</h3>
        <ul className="v2-quotes">
          {o.evidence.map((e) => {
            const side = o.sides.find((s) => s.id === e.sessionId);
            return (
              <li key={e.sessionId}>
                {side?.person && <Initials name={side.person.name} />}
                <span>
                  <span className="v2-quote">“{e.text}”</span>
                  <span className="o2-muted">
                    {side?.person?.name.split(" ")[0]}'s {side?.agent} · {ago(e.ts, fixtureClock)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="v2-foot">A shared file or task is a lead, not proof of wasted work – the two sides above are what the judgement rests on.</p>
      </section>
    </>
  );
}
