// Dashboard Home v2 – "People". The team is the organizing axis (like Linear's member profiles and
// team pages): a one-sentence status and four calm usage figures, then one section per person, most
// recently active first. Each section shows who it is, where they work (machines, harnesses), a tiny
// activity strip for the period, what is running right now and their latest sessions. "Show all"
// opens the person's full list in place; every row opens the session in the right panel.
// A switch regroups the same layout by machine.
import { useMemo, useState } from "react";
import { ChevronDown, Laptop } from "lucide-react";
import { fixtureClock, type ScenarioId } from "../scenarios";
import { HomeShell } from "./HomeShell";
import { ago, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";
import { HARNESS_LABELS, HarnessLogo, Initials } from "./WeekPanel";

type Mode = "people" | "machines";
type Group = {
  key: string;
  name: string;
  kind: Mode;
  sessions: SessionItem[];
  lastTs: string;
  /** Machines (people mode) or people (machines mode) this group spans */
  places: string[];
  sources: string[];
};

/** Rows a section shows before "Show all" */
const PREVIEW = 4;

const allSessions = (data: Overview) => {
  const list = data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions);
  return [...new Map(list.map((s) => [s.id, s])).values()];
};
const isRunning = (s: SessionItem) => s.status === "active";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const uniq = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];
const byRecent = (a: SessionItem, b: SessionItem) => Date.parse(b.lastTs) - Date.parse(a.lastTs);

function groupsFor(sessions: SessionItem[], mode: Mode): Group[] {
  const map = new Map<string, Group>();
  for (const s of sessions) {
    const key = mode === "people" ? (s.person?.id ?? "nobody") : (s.machine ?? "unknown");
    const name = mode === "people" ? (s.person?.name ?? "Unassigned") : (s.machine ?? "Unknown machine");
    const g = map.get(key) ?? { key, name, kind: mode, sessions: [], lastTs: s.lastTs, places: [], sources: [] };
    g.sessions.push(s);
    if (s.lastTs > g.lastTs) g.lastTs = s.lastTs;
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => {
      // Running work first, then the most recent
      const sorted = [...g.sessions].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || byRecent(a, b));
      return {
        ...g,
        sessions: sorted,
        places: uniq(sorted.map((s) => (mode === "people" ? s.machine : s.person?.name))),
        sources: uniq(sorted.map((s) => s.source)),
      };
    })
    .sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs));
}

/** Sessions touched per bucket – started or last active in it (hours for a day, days for longer periods) */
function buckets(sessions: SessionItem[], days: number) {
  const count = days === 1 ? 24 : days;
  const end = Date.parse(fixtureClock);
  const size = (days * 86_400_000) / count;
  const start = end - count * size;
  return Array.from({ length: count }, (_, i) => {
    const from = start + i * size;
    const to = from + size;
    const inside = (ts: string) => Date.parse(ts) >= from && Date.parse(ts) < to;
    return sessions.filter((s) => inside(s.firstTs) || inside(s.lastTs)).length;
  });
}

export function PeoplePage({ scenario }: { scenario: ScenarioId }) {
  return (
    <HomeShell scenario={scenario} page="people" className="hm2">
      {(data, pick, onPick) => <People data={data} pick={pick} onPick={onPick} />}
    </HomeShell>
  );
}

function People({ data, pick, onPick }: { data: Overview; pick: Pick | null; onPick: (p: Pick) => void }) {
  const [mode, setMode] = useState<Mode>("people");
  const sessions = useMemo(() => allSessions(data), [data]);
  const groups = useMemo(() => groupsFor(sessions, mode), [sessions, mode]);
  const strips = useMemo(() => groups.map((g) => buckets(g.sessions, data.period.days)), [groups, data.period.days]);
  // A floor of 3, so a single session per hour reads as a small mark rather than a full bar
  const peak = Math.max(3, ...strips.flat());

  const people = uniq(sessions.map((s) => s.person?.id)).length;
  const agents = uniq(sessions.map((s) => s.agent)).length;
  const running = sessions.filter(isRunning);
  const machines = uniq(sessions.map((s) => s.machine)).length;
  return (
    <>
      <header className="o2-hero">
        <p className="o2-eyebrow">
          {data.org} · {data.workspace}
        </p>
        <h2 className="o2-headline">
          {plural(people, "person", "people")}, {plural(agents, "agent")} –{" "}
          {running.length ? `${plural(running.length, "session")} running now` : "nothing running right now"}
        </h2>
        <p className="o2-sub">
          {data.period.label} · {plural(machines, "machine")}
        </p>
      </header>

      {/* The team's usage figures and charts live on the Overview page */}
      <section className="h2-team" aria-label={mode === "people" ? "People" : "Machines"}>
        <div className="h2-team__head">
          <h2 className="o2-h">{mode === "people" ? "People" : "Machines"}</h2>
          <div className="h2-seg" role="tablist" aria-label="Group by">
            {(["people", "machines"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                data-slot="h2-seg"
                aria-selected={mode === m}
                className="h2-seg__btn"
                onClick={() => setMode(m)}
              >
                {m === "people" ? "People" : "Machines"}
              </button>
            ))}
          </div>
        </div>
        <div className="h2-groups">
          {groups.map((g, i) => (
            <GroupSection key={`${mode}-${g.key}`} group={g} strip={strips[i]!} peak={peak} days={data.period.days} pick={pick} onPick={onPick} />
          ))}
        </div>
      </section>
    </>
  );
}

function GroupSection({
  group,
  strip,
  peak,
  days,
  pick,
  onPick,
}: {
  group: Group;
  strip: number[];
  peak: number;
  days: number;
  pick: Pick | null;
  onPick: (p: Pick) => void;
}) {
  const [open, setOpen] = useState(false);
  const runningCount = group.sessions.filter(isRunning).length;
  const limit = PREVIEW;
  const shown = open ? group.sessions : group.sessions.slice(0, limit);
  const now = shown.filter(isRunning);
  const rest = shown.filter((s) => !isRunning(s));
  const hidden = group.sessions.length - limit;
  const row = (s: SessionItem) => (
    <SessionLine key={s.id} s={s} mode={group.kind} showWhere={group.places.length > 1} picked={pick?.kind === "session" && pick.id === s.id} onOpen={() => onPick({ kind: "session", id: s.id, from: null })} />
  );

  return (
    <article className="h2-group">
      <header className="h2-group__head">
        {group.kind === "people" ? (
          <span className="h2-avatar" title={group.name}>
            <Initials name={group.name} />
          </span>
        ) : (
          <span className="h2-avatar h2-avatar--machine" title={group.name}>
            <Laptop size={16} aria-hidden="true" />
          </span>
        )}
        <div className="h2-group__who">
          {group.kind === "people" && group.key !== "nobody" ? (
            <h3 className="h2-group__name">
              {/* The person opens in the panel: their usage, projects and all their sessions */}
              <button type="button" data-slot="h2-person" className="h2-person" aria-pressed={pick?.kind === "person" && pick.id === group.key} onClick={() => onPick({ kind: "person", id: group.key })}>
                {group.name}
              </button>
            </h3>
          ) : (
            <h3 className="h2-group__name">{group.name}</h3>
          )}
          <p className="h2-group__meta">
            {group.places.length > 0 && <span className="h2-group__places">{group.places.join(", ")}</span>}
            <span className="h2-logos">
              {group.sources.map((src) => (
                <span key={src} title={HARNESS_LABELS[src] ?? src}>
                  <HarnessLogo source={src} />
                </span>
              ))}
            </span>
          </p>
        </div>
        <div className="h2-group__activity">
          <Strip values={strip} peak={peak} days={days} />
          <span className="h2-group__count">
            {plural(group.sessions.length, "session")} · {ago(group.lastTs, fixtureClock)}
          </span>
        </div>
      </header>

      {now.length > 0 && (
        <div className="h2-block">
          <p className="h2-block__label h2-block__label--now">
            Now{runningCount > 1 ? ` · ${runningCount} running` : ""}
          </p>
          <ul className="h2-rows">{now.map(row)}</ul>
        </div>
      )}
      {rest.length > 0 && (
        <div className="h2-block">
          <p className="h2-block__label">{now.length ? "Recent" : "Latest"}</p>
          <ul className="h2-rows">{rest.map(row)}</ul>
        </div>
      )}
      {hidden > 0 && (
        <button type="button" data-slot="h2-more" className="h2-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : `Show all ${group.sessions.length}`}
          <ChevronDown size={14} aria-hidden="true" className="h2-more__icon" />
        </button>
      )}
    </article>
  );
}

/** Sessions per hour (or day) across the period, as tiny bars on one shared scale */
function Strip({ values, peak, days }: { values: number[]; peak: number; days: number }) {
  const total = values.reduce((a, b) => a + b, 0);
  const unit = days === 1 ? "hour" : "day";
  return (
    <span className="h2-strip" role="img" aria-label={`Activity per ${unit} over the period`} data-dense={values.length > 14 || undefined}>
      {values.map((v, i) => (
        <span key={i} className="h2-strip__bar" data-on={v > 0 || undefined} style={{ height: v ? `${Math.max(20, (v / peak) * 100)}%` : undefined }} />
      ))}
      {total === 0 && <span className="h2-strip__none">No activity</span>}
    </span>
  );
}

function SessionLine({ s, mode, showWhere, picked, onOpen }: { s: SessionItem; mode: Mode; showWhere: boolean; picked: boolean; onOpen: () => void }) {
  const status = s.status === "active" ? "running" : s.status === "finished" ? "finished" : "paused";
  const label = status === "running" ? "Working" : status === "finished" ? "Finished" : "Paused";
  // In people mode the row says where it runs; in machines mode, whose it is – only when the section spans more than one
  const where = showWhere ? (mode === "people" ? s.machine : s.person?.name) : null;
  return (
    <li>
      <button type="button" data-slot="h2-row" className="h2-row" data-status={status} aria-current={picked || undefined} onClick={onOpen}>
        <span className="h2-row__lead" title={HARNESS_LABELS[s.source] ?? s.source}>
          <HarnessLogo source={s.source} />
        </span>
        <span className="h2-row__text">
          <span className="h2-row__title">{s.title}</span>
          <span className="h2-row__summary" data-missing={s.summary === null || undefined}>
            {s.summary ?? "No summary yet"}
          </span>
        </span>
        <span className="h2-row__side" data-where={showWhere || undefined}>
          {showWhere && (
            <span className="h2-row__where">
              {mode === "machines" && s.person && <Initials name={s.person.name} />}
              {where}
            </span>
          )}
          <span className="h2-tag" data-status={status}>
            {label}
          </span>
          <span className="h2-row__ago">{ago(s.lastTs, fixtureClock)}</span>
        </span>
      </button>
    </li>
  );
}
