// Operator view v2 – "Briefing": the overview as a short written weekly report, read top to bottom
// like a memo. Patterns: Asana's AI summary ("Recent activity" + "Risk report"), ClickUp's AI StandUp
// ("Overview" + "Key highlights"), Devin's session insights (each claim points to its session).
import { ArrowUpRight } from "lucide-react";
import type { ScenarioId } from "../scenarios";
import { fixtureClock } from "../scenarios";
import { Frame } from "./Frame";
import { InitiativeDetail, Initials, SessionDetail, WeekPanel } from "./WeekPanel";
import { ago, formatTokens, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";

const range = (days: number) => {
  const end = new Date(fixtureClock);
  const start = new Date(end.getTime() - Math.max(0, days - 1) * 86_400_000);
  const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return days === 1 ? f(end) : `${f(start)} – ${f(end)}`;
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export function OperatorV2({ scenario }: { scenario: ScenarioId }) {
  return (
    <Frame
      scenario={scenario}
      title="Briefing"
      className="o3"
      idle={{ title: "This week", open: true, render: (data, onPick) => <WeekPanel data={data} onPick={onPick} /> }}
      detail={{
        initiative: (item, tab, onSession) => <InitiativeDetail item={item} tab={tab} onSession={onSession} />,
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {(data, pick, onPick) => <Briefing data={data} pick={pick} onPick={onPick} />}
    </Frame>
  );
}

/** A small numbered source badge in the text; on hover it says which session it opens */
function SessionLink({ id, session, onPick }: { id: string; session?: SessionItem; onPick: (p: Pick) => void }) {
  const tip = session ? `${session.title} · ${session.person?.name ?? "Unknown"}` : "Open the session";
  return (
    <button
      type="button"
      data-slot="o3-src"
      className="o3-src"
      data-tip={tip}
      aria-label={`Open session: ${tip}`}
      onClick={() => onPick({ kind: "session", id, from: null })}
    >
      {id.replace("design-session-", "")}
    </button>
  );
}

function Briefing({ data, pick, onPick }: { data: Overview; pick: Pick | null; onPick: (p: Pick) => void }) {
  const sessionById = (id: string) => data.initiatives.flatMap((i) => i.sessions).find((s) => s.id === id);
  if (data.analysis === "empty")
    return (
      <div className="o2-empty">
        <h2>Nothing to report yet</h2>
        <p>The first briefing is written once the team's agents have recorded some work.</p>
      </div>
    );
  const current = data.analysis === "current";
  const review = data.initiatives.filter((i) => i.tone === "review");
  const progress = data.initiatives.filter((i) => i.tone === "progress");
  const blocked = data.initiatives.filter((i) => i.tone === "blocked");
  const top = [...data.initiatives].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))[0];
  const total = data.budget.tokens ?? 0;

  const overview = current
    ? [
        `The team moved ${data.initiatives.length} initiatives forward ${data.period.days === 1 ? "today" : data.period.days === 7 ? "this week" : "this month"}.`,
        review.length ? `${list(review.map((i) => i.name))} ${review.length === 1 ? "is" : "are"} ready for review.` : "",
        progress.length ? `${list(progress.map((i) => i.name))} ${progress.length === 1 ? "is" : "are"} in progress.` : "",
        blocked.length ? `${list(blocked.map((i) => i.name))} ${blocked.length === 1 ? "is" : "are"} waiting on a decision.` : "",
        top && total ? `Most tokens went to ${top.name} (${Math.round(((top.tokens ?? 0) / total) * 100)}%).` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : `${data.sessions} sessions ran across ${data.projects.length} projects. The analysis behind the written briefing is older than this work, so only activity is reported until it runs again.`;

  return (
    <article className="o3-doc">
      <header className="o3-head">
        <p className="o3-date">{data.period.days === 1 ? "Today" : data.period.label} · {range(data.period.days)}</p>
        <h2 className="o3-title">Engineering briefing</h2>
        <p className="o3-byline">
          Written from {data.sessions} sessions by {data.people} people · updated {ago(fixtureClock, fixtureClock).toLowerCase()}
        </p>
        <ul className="o3-glance" aria-label="At a glance">
          {current && (
            <>
              <li>
                <span className="o2-health__dot" /> {data.initiatives.length - blocked.length} on track
              </li>
              {blocked.length > 0 && (
                <li>
                  <span className="o2-health__dot" data-risk /> {blocked.length} at risk
                </li>
              )}
            </>
          )}
          <li>{formatTokens(data.budget.tokens)} tokens</li>
        </ul>
      </header>

      <section className="o3-sec">
        <h3>Summary</h3>
        <p className="o3-lead">{overview}</p>
      </section>

      {current && (
        <section className="o3-sec">
          <h3>Initiatives</h3>
          {data.initiatives.map((item) => (
            <div key={item.id} className="o3-init">
              <button
                type="button"
                data-slot="o3-init"
                className="o3-init__name"
                aria-pressed={pick?.kind === "initiative" && pick.id === item.id}
                onClick={() => onPick({ kind: "initiative", id: item.id })}
              >
                <span className="o2-health__dot" data-risk={item.health === "at-risk" || undefined} />
                {item.name}
                <ArrowUpRight size={14} aria-hidden="true" className="o3-init__arrow" />
              </button>
              <p>{item.update}</p>
              <ul className="o3-bullets">
                {/* One bullet per distinct result – repeated reports of the same thing would just add noise */}
                {[...new Map(item.sessions.map((s) => [s.result, s])).values()].slice(0, 3).map((s) => (
                  <li key={s.id}>
                    {s.person && <Initials name={s.person.name} />}
                    <span>
                      {s.person?.name.split(" ")[0]}'s agent: {lower(s.result)} <SessionLink id={s.id} session={s} onPick={onPick} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {current && data.stuck.length > 0 && (
        <section className="o3-sec">
          <h3>Risks</h3>
          {data.stuck.map((item) => (
            <p key={item.id}>
              <strong>{item.initiative}:</strong> {lower(item.text)} Until that's settled the rollout can't be validated.{" "}
              {item.sessions.map((id) => (
                <SessionLink key={id} id={id} session={sessionById(id)} onPick={onPick} />
              ))}
            </p>
          ))}
        </section>
      )}

      <section className="o3-sec">
        <h3>Spend</h3>
        <p>
          {formatTokens(data.budget.tokens)} tokens across {data.sessions} sessions. Cost isn't reported yet
          {data.budget.tokenSessions < data.sessions ? `, and only ${data.budget.tokenSessions} sessions report tokens` : ""}.
        </p>
        <ul className="o3-spend">
          {(current ? data.initiatives.map((i) => ({ name: i.name, tokens: i.tokens ?? 0 })) : data.projects.map((p) => ({ name: p.name, tokens: p.tokens ?? 0 }))).map(
            (row) => (
              <li key={row.name}>
                <span>{row.name}</span>
                <span className="o3-spend__bar">
                  <span style={{ width: `${total ? (row.tokens / total) * 100 : 0}%` }} />
                </span>
                <span className="o2-num">{formatTokens(row.tokens)}</span>
              </li>
            ),
          )}
        </ul>
      </section>

      {current && data.improvements.length > 0 && (
        <section className="o3-sec">
          <h3>Suggestions</h3>
          <ol className="o3-suggest">
            {data.improvements.map((item) => (
              <li key={item.id}>
                <p className="o3-suggest__title">{item.suggestion}</p>
                <p className="o2-muted">
                  Why: {lower(item.observation)} {item.sessions.map((id) => <SessionLink key={id} id={id} session={sessionById(id)} onPick={onPick} />)}
                </p>
                <p className="o2-muted">How we'd know: {lower(item.measure)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="o2-foot">Written automatically from the team's sessions. The small numbers open the session a statement comes from. Proposed – not part of today's API.</footer>
    </article>
  );
}
