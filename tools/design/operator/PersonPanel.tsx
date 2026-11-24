// A person in the side panel – the dashboard's "usage → person → session" drill-down. Overview: who
// they are, where and with which agents they work, how they use Relay, what runs now and their
// projects. Sessions: everything they ran in the period. A session opens in the panel, with a back
// link to the person.
import { CalendarClock, Coins, FolderOpen, Laptop, MessagesSquare, Search, Sparkles } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, formatTokens, type Overview, type SessionItem } from "./model";
import { HARNESS_LABELS, HarnessLogo, Initials, SessionRow } from "./WeekPanel";

export const PERSON_TABS = ["Overview", "Sessions"] as const;

/** The person's sessions in the period, newest first */
export function sessionsOf(data: Overview, personId: string): SessionItem[] {
  const all = data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions);
  return all.filter((s) => s.person?.id === personId).sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs));
}

/** Who this is: the team member if the workspace knows them, else what their sessions say */
export function personOf(data: Overview, personId: string) {
  const member = data.team.members.find((m) => m.id === personId);
  const fromSession = sessionsOf(data, personId)[0]?.person;
  if (!member && !fromSession) return null;
  return { id: personId, name: member?.name ?? fromSession!.name, member };
}

export function PersonDetail({ data, personId, tab, onSession }: { data: Overview; personId: string; tab: string; onSession: (id: string) => void }) {
  const person = personOf(data, personId);
  if (!person) return null;
  const sessions = sessionsOf(data, personId);
  const running = sessions.filter((s) => s.status === "active");
  const machines = [...new Set(sessions.flatMap((s) => (s.machine ? [s.machine] : [])))];
  const harnesses = [...new Set(sessions.map((s) => s.source))];
  const tokens = sessions.reduce((a, s) => a + (s.tokens ?? 0), 0);
  const m = person.member;
  // Projects as the workspace reports them for this person (as on today's person page)
  const projects = m?.topProjects ?? [];

  return (
    <div className="o-week o-week--detail">
      {tab === "Overview" ? (
        <>
          <section className="o-card" aria-label={person.name}>
            <div className="o-card__head pp-head">
              <span className="pp-avatar">
                <Initials name={person.name} />
              </span>
              <span>
                <h2 className="o-card__name">{person.name}</h2>
                {m && (
                  <p className="o-card__sub">
                    {m.role.charAt(0).toUpperCase() + m.role.slice(1)} · {m.email}
                  </p>
                )}
              </span>
            </div>
            <dl className="o-props">
              <dt>Machines</dt>
              <dd className="o-props__stack">
                {machines.length ? (
                  machines.map((x) => (
                    <span key={x}>
                      <Laptop size={14} aria-hidden="true" /> {x}
                    </span>
                  ))
                ) : (
                  <span className="o-props__muted">Not reported</span>
                )}
              </dd>
              <dt>Agents</dt>
              <dd className="o-props__stack">
                {harnesses.map((h) => (
                  <span key={h}>
                    <HarnessLogo source={h} /> {HARNESS_LABELS[h] ?? h}
                  </span>
                ))}
              </dd>
              <dt>Sessions</dt>
              <dd>
                <MessagesSquare size={14} aria-hidden="true" /> {sessions.length}
                {running.length ? ` · ${running.length} running` : ""}
              </dd>
              {m && (
                <>
                  <dt>Searches</dt>
                  <dd>
                    <Search size={14} aria-hidden="true" /> {m.searches}
                  </dd>
                </>
              )}
              <dt>Summaries</dt>
              <dd className={data.team.summaries === null ? "o-props__muted" : undefined}>
                <Sparkles size={14} aria-hidden="true" />{" "}
                {data.team.summaries === null ? "Not reported" : `${sessions.filter((s) => s.summary).length} of ${sessions.length} sessions`}
              </dd>
              <dt>Tokens</dt>
              <dd>
                <Coins size={14} aria-hidden="true" /> {formatTokens(tokens)}
              </dd>
              <dt>Last active</dt>
              <dd>
                <CalendarClock size={14} aria-hidden="true" /> {ago(sessions[0]?.lastTs ?? m?.lastActiveAt ?? null, fixtureClock)}
              </dd>
            </dl>
          </section>

          {running.length > 0 && (
            <section className="o-card" aria-label="Running now">
              <h3 className="o-card__title">Running now</h3>
              <ul className="o-activity">
                {running.map((s) => (
                  <SessionRow key={s.id} s={s} onOpen={() => onSession(s.id)} />
                ))}
              </ul>
            </section>
          )}

          {projects.length > 0 && (
            <section className="o-card" aria-label="Projects">
              <h3 className="o-card__title">Projects</h3>
              <ul className="o-breakdown">
                {projects.map((p) => (
                  <li key={p.name}>
                    <FolderOpen size={14} aria-hidden="true" className="o-lead-icon" />
                    <span className="o-breakdown__label">{p.name}</span>
                    <span className="o2-num">{p.sessions}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="o-card" aria-label="Latest sessions">
            <h3 className="o-card__title">Latest</h3>
            <ul className="o-activity">
              {sessions
                .filter((s) => s.status !== "active")
                .slice(0, 3)
                .map((s) => (
                  <SessionRow key={s.id} s={s} onOpen={() => onSession(s.id)} />
                ))}
            </ul>
          </section>
        </>
      ) : (
        <section className="o-card" aria-label="All sessions">
          <h3 className="o-card__title">
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"} · {data.period.label.toLowerCase()}
          </h3>
          <ul className="o-activity">
            {sessions.map((s) => (
              <SessionRow key={s.id} s={s} onOpen={() => onSession(s.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
