// Dashboard Home v3 – "Timeline". Who had which agent running when, in the manner of Wrike's workload
// view: one lane per person (or machine) on the left, the period's time axis across the top, every
// session a rounded bar from its start to its last event, a thin line at "now". Below it the two
// lists people come for: what is running now and what finished last. Bars and rows open the session.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";
import { HARNESS_LABELS, HarnessLogo, Initials } from "./WeekPanel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Gridline / label steps, smallest first – the first one that leaves room for a label wins */
const STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
const LABEL_MIN_PX = 64;
/** Below this width a bar shows only its logo, below the next one nothing */
const TITLE_MIN_PX = 88;
const LOGO_MIN_PX = 24;

type Grouping = "person" | "machine";
type Placed = { s: SessionItem; start: number; end: number; row: number };
type Lane = { id: string; name: string; kind: Grouping; sources: string[]; rows: number; bars: Placed[] };

const running = (s: SessionItem) => s.status === "active";
const tone = (s: SessionItem) => (running(s) ? "running" : s.status === "finished" ? "finished" : "idle");
const STATE_LABEL = { running: "Running", finished: "Finished", idle: "Idle" } as const;

function allSessions(data: Overview) {
  const list = data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions);
  return [...new Map(list.map((s) => [s.id, s])).values()];
}

/**
 * The visible window: the whole period, unless the data covers much less of it – then the axis zooms
 * to the span that has sessions (rounded out to whole hours or days) so the bars stay readable.
 */
function windowFor(sessions: SessionItem[], days: number, now: number) {
  const periodStart = now - days * DAY;
  const earliest = Math.max(periodStart, Math.min(...sessions.map((s) => Date.parse(s.firstTs))));
  const dataSpan = now - earliest;
  const zoomed = dataSpan < days * DAY * 0.5;
  const unit = dataSpan > 3 * DAY ? DAY : HOUR;
  // Rounded out to a whole hour / day, and never shorter than six hours
  const start = zoomed ? Math.min(Math.floor((earliest - unit) / unit) * unit, now - 6 * HOUR) : periodStart;
  // A little room after "now", so the line and running bars don't sit on the edge
  const end = now + (now - start) * 0.03;
  return { start, end, zoomed };
}

/** Lanes with their sessions stacked into sub-rows wherever two of them overlap in time */
function lanesFor(sessions: SessionItem[], by: Grouping, start: number, now: number, gap: number): Lane[] {
  const groups = new Map<string, { name: string; items: SessionItem[] }>();
  for (const s of sessions) {
    const id = by === "person" ? (s.person?.id ?? "none") : (s.machine ?? "none");
    const name = by === "person" ? (s.person?.name ?? "Unassigned") : (s.machine ?? "Unknown machine");
    const g = groups.get(id) ?? { name, items: [] };
    g.items.push(s);
    groups.set(id, g);
  }
  const lanes = [...groups].map(([id, g]) => {
    const ends: number[] = [];
    const bars = g.items
      .map((s) => ({ s, start: Math.max(start, Date.parse(s.firstTs)), end: running(s) ? now : Date.parse(s.lastTs) }))
      .sort((a, b) => a.start - b.start)
      .map((b) => {
        let row = ends.findIndex((e) => e + gap <= b.start);
        if (row < 0) row = ends.push(0) - 1;
        ends[row] = Math.max(b.end, b.start);
        return { ...b, row };
      });
    return { id, name: g.name, kind: by, sources: [...new Set(g.items.map((s) => s.source))], rows: Math.max(1, ends.length), bars };
  });
  // Lanes with something running first, then by most recent activity
  const latest = (l: Lane) => Math.max(...l.bars.map((b) => b.end));
  return lanes.sort((a, b) => Number(b.bars.some((x) => running(x.s))) - Number(a.bars.some((x) => running(x.s))) || latest(b) - latest(a));
}

function tickLabel(t: number, step: number, first: boolean) {
  const d = new Date(t);
  if (step >= DAY) return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.getHours() === 0 || first ? `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}` : time;
}


/** The Sessions page's timeline view: lanes per person or machine, then Running now and Latest */
export function TimelineView({ data, selected, onPick }: { data: Overview; selected: string | null; onPick: (p: Pick) => void }) {
  const sessions = useMemo(() => allSessions(data), [data]);
  const live = sessions.filter(running).sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs));
  const latest = sessions
    .filter((s) => !running(s))
    .sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs))
    .slice(0, 6);
  const open = (s: SessionItem) => onPick({ kind: "session", id: s.id, from: null });
  const periodText = data.period.label.charAt(0).toLowerCase() + data.period.label.slice(1);

  return (
    <>

      {sessions.length > 0 && <Timeline sessions={sessions} days={data.period.days} selected={selected} onOpen={open} onPerson={(id) => onPick({ kind: "person", id })} />}

      <div className="h3-lists">
        <SessionList title="Running now" empty="Nothing is running right now." items={live} selected={selected} onOpen={open} />
        <SessionList title="Latest" empty={`No finished sessions in the ${periodText}.`} items={latest} selected={selected} onOpen={open} />
      </div>
    </>
  );
}

function Timeline({ sessions, days, selected, onOpen, onPerson }: { sessions: SessionItem[]; days: number; selected: string | null; onOpen: (s: SessionItem) => void; onPerson: (id: string) => void }) {
  const [by, setBy] = useState<Grouping>("person");
  const now = Date.parse(fixtureClock);
  const { start, end, zoomed } = useMemo(() => windowFor(sessions, days, now), [sessions, days, now]);
  const span = end - start;

  // The track's width in pixels – re-measured whenever the page narrows (e.g. the panel opens)
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerMs = width / span;
  // Two bars share a sub-row only with a few pixels between them
  const lanes = useMemo(() => lanesFor(sessions, by, start, now, pxPerMs ? 4 / pxPerMs : 0), [sessions, by, start, now, pxPerMs]);
  const step = STEPS.find((s) => s * pxPerMs >= LABEL_MIN_PX) ?? STEPS[STEPS.length - 1]!;
  // Gridlines on local whole hours (or midnights when hours get too narrow), labels on every `step`
  const minor = step < DAY && HOUR * pxPerMs >= 8 ? HOUR : DAY;
  const grid: number[] = [];
  const ticks: number[] = [];
  const first = new Date(start);
  first.setMinutes(60, 0, 0);
  for (let t = first.getTime(); t < end; t += HOUR) {
    const d = new Date(t);
    const midnight = d.getHours() === 0;
    if (minor === HOUR || midnight) grid.push(t);
    const onStep = step >= DAY ? midnight && Math.round(t / DAY) % (step / DAY) === 0 : d.getHours() % (step / HOUR) === 0;
    // Keep labels clear of the "Now" pill
    if (onStep && (now - t) * pxPerMs > 44) ticks.push(t);
  }
  const x = (t: number) => `${((t - start) / span) * 100}%`;
  const spanText = span > 2 * DAY ? `${Math.round((now - start) / DAY)} days` : `${Math.round((now - start) / HOUR)} hours`;

  return (
    <section className="o2-section" aria-label="Timeline">
      <div className="o2-split-head">
        <div className="h3-head">
          <h2 className="o2-h">Who ran what, when</h2>
          {zoomed && <p className="o2-muted h3-note">Showing the last {spanText}, where the sessions are</p>}
        </div>
        <div className="o2-seg" role="tablist" aria-label="Lanes by">
          {(["person", "machine"] as const).map((g) => (
            <button key={g} type="button" role="tab" data-slot="o2-seg" aria-selected={by === g} onClick={() => setBy(g)}>
              {g === "person" ? "Person" : "Machine"}
            </button>
          ))}
        </div>
      </div>

      <div className="h3-stage">
        <div className="h3-grid">
          {/* Axis row */}
          <div className="h3-corner" style={{ gridArea: "1 / 1" }} aria-hidden="true" />
          <div className="h3-axis" style={{ gridArea: "1 / 2" }} aria-hidden="true">
            {ticks.map((t, i) => (
              <span key={t} className="h3-axis__tick" style={{ left: x(t) }}>
                {tickLabel(t, step, i === 0)}
              </span>
            ))}
            <span className="h3-axis__now" style={{ left: x(now) }}>
              Now
            </span>
          </div>

          {lanes.map((lane, i) => (
            <Row key={lane.id} line={i + 2} lane={lane} x={x} pxPerMs={pxPerMs} selected={selected} onOpen={onOpen} onPerson={onPerson} />
          ))}

          {/* Gridlines and the now line, laid over the whole track column */}
          <div className="h3-overlay" ref={trackRef} style={{ gridArea: `1 / 2 / ${lanes.length + 2} / 3` }} aria-hidden="true">
            {grid.map((t) => (
              <span key={t} className="h3-gridline" data-major={ticks.includes(t) || undefined} style={{ left: x(t) }} />
            ))}
            <span className="h3-nowline" style={{ left: x(now) }} />
          </div>
        </div>

        <ul className="h3-legend" aria-label="Legend">
          {(["running", "finished", "idle"] as const).map((t) => (
            <li key={t}>
              <span className="h3-swatch" data-tone={t} /> {STATE_LABEL[t]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Row({
  line,
  lane,
  x,
  pxPerMs,
  selected,
  onOpen,
  onPerson,
}: {
  onPerson: (id: string) => void;
  /** The grid row this lane sits in (row 1 is the axis) */
  line: number;
  lane: Lane;
  x: (t: number) => string;
  pxPerMs: number;
  selected: string | null;
  onOpen: (s: SessionItem) => void;
}) {
  return (
    <>
      <div className="h3-lane-label" style={{ gridArea: `${line} / 1` }}>
        {lane.kind === "person" ? (
          lane.id === "none" ? <span className="h3-ico" /> : <Initials name={lane.name} />
        ) : (
          <span className="h3-ico">
            <Monitor size={14} aria-hidden="true" />
          </span>
        )}
        {lane.kind === "person" && lane.id !== "none" ? (
          // A person's name opens them in the panel: usage, projects and all their sessions
          <button type="button" data-slot="h3-person" className="h3-lane-label__name h3-person" title={lane.name} onClick={() => onPerson(lane.id)}>
            {lane.name}
          </button>
        ) : (
          <span className="h3-lane-label__name" title={lane.name}>
            {lane.name}
          </span>
        )}
        <span className="h3-lane-label__logos">
          {lane.sources.map((src) => (
            <span key={src} title={HARNESS_LABELS[src] ?? src}>
              <HarnessLogo source={src} />
            </span>
          ))}
        </span>
      </div>
      <div className="h3-lane" style={{ gridArea: `${line} / 2`, height: lane.rows * 30 + 10 }}>
        {lane.bars.map(({ s, start, end, row }) => {
          const px = (end - start) * pxPerMs;
          const t = tone(s);
          return (
            <button
              key={s.id}
              type="button"
              data-slot="h3-bar"
              className="h3-bar"
              data-tone={t}
              aria-pressed={selected === s.id}
              aria-label={`${s.title} – ${STATE_LABEL[t]}`}
              title={s.title}
              style={{ left: x(start), width: `max(6px, calc(${x(end)} - ${x(start)}))`, top: 5 + row * 30 }}
              onClick={() => onOpen(s)}
            >
              {px >= LOGO_MIN_PX && <HarnessLogo source={s.source} />}
              {px >= TITLE_MIN_PX && <span className="h3-bar__title">{s.title}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

function SessionList({
  title,
  empty,
  items,
  selected,
  onOpen,
}: {
  title: string;
  empty: string;
  items: SessionItem[];
  selected: string | null;
  onOpen: (s: SessionItem) => void;
}) {
  return (
    <section className="o2-section h3-list" aria-label={title}>
      <h2 className="o2-h">
        {title}
        {items.length > 0 && <span className="h3-count">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="o2-muted h3-empty">{empty}</p>
      ) : (
        <ul className="h3-rows">
          {items.map((s) => (
            <li key={s.id}>
              <button type="button" data-slot="h3-row" className="h3-row" aria-pressed={selected === s.id} onClick={() => onOpen(s)}>
                <span className="h3-row__dot" data-tone={tone(s)} aria-hidden="true" />
                <span className="h3-row__text">
                  <span className="h3-row__title">{s.title}</span>
                  {s.summary && <span className="h3-row__summary">{s.summary}</span>}
                  <span className="h3-row__meta">
                    {s.person && (
                      <span className="h3-row__who">
                        <Initials name={s.person.name} />
                        {s.person.name}
                      </span>
                    )}
                    <span className="h3-row__who">
                      <HarnessLogo source={s.source} />
                      {HARNESS_LABELS[s.source] ?? s.source}
                    </span>
                    <span>{running(s) ? `Started ${ago(s.firstTs, fixtureClock).toLowerCase()}` : ago(s.lastTs, fixtureClock)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
