// Map page – how the work hangs together, drawn instead of listed. Four columns, left to right:
// people → their agents (one per harness) → the initiatives the agents work on → what came out.
// The connectors are the affectUI Agent Tree's (thin, right-angled, a hollow dot at the source). Overlaps
// are brackets between the two agents involved: solid when they talked over the relay, dashed when they
// worked blind, dotted when it isn't known. Point at anything and its path lights up
// while the rest steps back (the affectUI Decision Tree's way of reading a branch); click an initiative
// or an overlap to open it in the panel, anything else to hold its path.
//
// The questions it answers for a CTO: do parallel agents coordinate or work blind? Where does work
// pile up, and what rests on a single person? Which path do the tokens take to a result?
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  CircleCheck,
  CirclePause,
  CircleDot,
  FolderOpen,
  GitCompareArrows,
  Users,
} from "lucide-react";
import type { ScenarioId } from "../scenarios";
import { Frame } from "./Frame";
import { formatTokens, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";
import { KIND_ICONS } from "./OverlapPanel";
import type { Overlap } from "./overlaps";
import {
  HarnessLogo,
  HARNESS_LABELS,
  InitiativeDetail,
  Initials,
  SessionDetail,
} from "./WeekPanel";

export type Weight = "tokens" | "sessions";
type Column = "person" | "agent" | "initiative" | "outcome";
type MapNode = {
  id: string;
  col: Column;
  label: string;
  meta: string;
  sessions: SessionItem[];
  lead: ReactNode;
};
type MapLink = { from: string; to: string; sessions: SessionItem[] };

const COLUMNS: { id: Column; label: string }[] = [
  { id: "person", label: "People" },
  { id: "agent", label: "Agents" },
  { id: "initiative", label: "Initiatives" },
  { id: "outcome", label: "Outcome" },
];
export const OUTCOMES = [
  { id: "finished", label: "Finished", icon: CircleCheck },
  { id: "active", label: "Still running", icon: CircleDot },
  { id: "paused", label: "Paused", icon: CirclePause },
] as const;
export const outcomeOf = (s: SessionItem) =>
  s.status === "finished"
    ? "finished"
    : s.status === "active"
      ? "active"
      : "paused";
export const personKey = (s: SessionItem) => s.person?.id ?? "unknown";
export const agentKey = (s: SessionItem) => `${personKey(s)}:${s.source}`;
export const harness = (source: string) => HARNESS_LABELS[source] ?? source;
export const first = (name: string) => name.split(" ")[0];
export const weigh = (list: SessionItem[], w: Weight) =>
  w === "sessions"
    ? list.length
    : list.reduce((a, s) => a + (s.tokens ?? 0), 0);
export const amount = (n: number, w: Weight) =>
  w === "sessions"
    ? `${n} ${n === 1 ? "session" : "sessions"}`
    : `${formatTokens(n)} tokens`;

/** Groups of sessions by a key, keeping the first-seen order */
export function group<T>(list: SessionItem[], key: (s: SessionItem) => T) {
  const m = new Map<T, SessionItem[]>();
  for (const s of list) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
  return m;
}

/** The graph: nodes per column and the links between neighbouring columns, each link carrying its sessions */
function graphOf(data: Overview, w: Weight) {
  const groups = data.initiatives.length
    ? data.initiatives.map((i) => ({
        id: i.id,
        name: i.name,
        sessions: i.sessions,
      }))
    : data.projects.map((p) => ({
        id: p.name,
        name: p.name,
        sessions: p.sessions,
      }));
  const initiativeOf = new Map(
    groups.flatMap((g) => g.sessions.map((s) => [s.id, g.id] as const)),
  );
  const sessions = groups.flatMap((g) => g.sessions);
  const byWeight = (
    a: { sessions: SessionItem[] },
    b: { sessions: SessionItem[] },
  ) => weigh(b.sessions, w) - weigh(a.sessions, w);

  const people: MapNode[] = [...group(sessions, personKey)]
    .map(([id, list]) => {
      const name = list[0]!.person?.name ?? "Unknown";
      return {
        id: `p:${id}`,
        col: "person" as const,
        label: name,
        meta: amount(weigh(list, w), w),
        sessions: list,
        lead: <Initials name={name} />,
      };
    })
    .sort(byWeight);
  const personOrder = people.map((p) => p.id);
  const agents: MapNode[] = [...group(sessions, agentKey)]
    .map(([id, list]) => {
      const s = list[0]!;
      return {
        id: `a:${id}`,
        col: "agent" as const,
        label: harness(s.source),
        meta: `${s.person ? `${first(s.person.name)}'s` : "Unknown"} · ${list.length} ${list.length === 1 ? "session" : "sessions"}`,
        sessions: list,
        lead: <HarnessLogo source={s.source} />,
      };
    })
    // Under their person, so the lines from the first column barely cross
    .sort(
      (a, b) =>
        personOrder.indexOf(`p:${personKey(a.sessions[0]!)}`) -
          personOrder.indexOf(`p:${personKey(b.sessions[0]!)}`) ||
        byWeight(a, b),
    );
  const agentOrder = agents.map((a) => a.id);
  const initiatives: MapNode[] = groups
    .filter((g) => g.sessions.length)
    .map((g) => ({
      id: `i:${g.id}`,
      col: "initiative" as const,
      label: g.name,
      meta: `${new Set(g.sessions.map(agentKey)).size} agents · ${amount(weigh(g.sessions, w), w)}`,
      sessions: g.sessions,
      lead: <FolderOpen size={14} aria-hidden="true" className="o-lead-icon" />,
    }))
    // Where their agents sit on average – keeps the middle of the map untangled
    .sort((a, b) => {
      const at = (n: MapNode) =>
        n.sessions.reduce(
          (t, s) => t + agentOrder.indexOf(`a:${agentKey(s)}`),
          0,
        ) / n.sessions.length;
      return at(a) - at(b);
    });
  const outcomes: MapNode[] = OUTCOMES.map((o) => {
    const list = sessions.filter((s) => outcomeOf(s) === o.id);
    const Icon = o.icon;
    return {
      id: `o:${o.id}`,
      col: "outcome" as const,
      label: o.label,
      meta: amount(weigh(list, w), w),
      sessions: list,
      lead: (
        <Icon
          size={14}
          aria-hidden="true"
          className="mp-outcome-icon"
          data-outcome={o.id}
        />
      ),
    };
  }).filter((o) => o.sessions.length);

  const links: MapLink[] = [];
  const add = (
    from: (s: SessionItem) => string,
    to: (s: SessionItem) => string,
  ) => {
    for (const [k, list] of group(sessions, (s) => `${from(s)}>${to(s)}`)) {
      const [a, b] = k.split(">");
      links.push({ from: a!, to: b!, sessions: list });
    }
  };
  add(
    (s) => `p:${personKey(s)}`,
    (s) => `a:${agentKey(s)}`,
  );
  add(
    (s) => `a:${agentKey(s)}`,
    (s) => `i:${initiativeOf.get(s.id)}`,
  );
  add(
    (s) => `i:${initiativeOf.get(s.id)}`,
    (s) => `o:${outcomeOf(s)}`,
  );
  return {
    columns: {
      person: people,
      agent: agents,
      initiative: initiatives,
      outcome: outcomes,
    },
    links,
  };
}

const NODE_H = 48;
const ROW_GAP = 14;

/** What is lit: a set of sessions, from the node or overlap pointed at (or held by a click) */
export type Focus = { key: string; sessions: Set<string> } | null;

function FlowMap({
  data,
  pick,
  onPick,
}: {
  data: Overview;
  pick: Pick | null;
  onPick: (p: Pick) => void;
}) {
  const [weight, setWeight] = useState<Weight>("tokens");
  const [hover, setHover] = useState<Focus>(null);
  const [held, setHeld] = useState<Focus>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.round(e!.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { columns, links } = useMemo(
    () => graphOf(data, weight),
    [data, weight],
  );
  const overlaps = data.overlaps;

  // Layout: four columns spread over the width, each column centred vertically
  const nodeW = Math.max(132, Math.min(210, (width - 3 * 88) / 4));
  const gapX = (width - 4 * nodeW) / 3;
  const rows = Math.max(...COLUMNS.map((c) => columns[c.id].length));
  const height = rows * (NODE_H + ROW_GAP) - ROW_GAP;
  const pos = new Map<string, { x: number; y: number }>();
  COLUMNS.forEach((c, ci) => {
    const list = columns[c.id];
    const top = (height - (list.length * (NODE_H + ROW_GAP) - ROW_GAP)) / 2;
    list.forEach((n, i) =>
      pos.set(n.id, {
        x: ci * (nodeW + gapX),
        y: top + i * (NODE_H + ROW_GAP),
      }),
    );
  });

  // Connectors as in the affectUI Agent Tree: thin, right-angled with rounded corners, a hollow dot where
  // they leave a card. Every line out of a node leaves from its middle and runs to a shared trunk halfway
  // across the gap, so a node's lines branch like a tree instead of fanning out.
  const R = 8;
  const elbow = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    tx: number,
  ) => {
    const dy = y2 - y1;
    if (Math.abs(dy) < 2) return `M${x1} ${y1}H${x2}`;
    const sg = Math.sign(dy);
    const r = Math.min(R, Math.abs(dy) / 2, tx - x1, x2 - tx);
    return `M${x1} ${y1}H${tx - r}Q${tx} ${y1} ${tx} ${y1 + sg * r}V${y2 - sg * r}Q${tx} ${y2} ${tx + r} ${y2}H${x2}`;
  };
  // In the gap after the agents the trunk sits further right – the overlap brackets use the space before it
  const trunk = (from: string, x1: number) =>
    x1 + gapX * (from.startsWith("a:") ? 0.66 : 0.5);

  const focus = held ?? hover;
  const lit = (list: SessionItem[]) =>
    !focus || list.some((s) => focus.sessions.has(s.id));
  const pickedId =
    pick?.kind === "initiative"
      ? `i:${pick.id}`
      : pick?.kind === "overlap"
        ? `ov:${pick.id}`
        : null;
  const focusOn = (key: string, list: SessionItem[]): Focus => ({
    key,
    sessions: new Set(list.map((s) => s.id)),
  });

  // Overlaps: a bracket out of the right side of both agents – shorter ones close to the cards, longer ones
  // further out, so no two lie on each other. One agent overlapping with itself gets a small hook.
  const span = (o: Overlap) =>
    Math.abs(
      (pos.get(`a:${agentKey(o.sides[0])}`)?.y ?? 0) -
        (pos.get(`a:${agentKey(o.sides[1])}`)?.y ?? 0),
    );
  const ranked = [...overlaps].sort((a, b) => span(a) - span(b));
  const reach = (rank: number) => Math.min(gapX * 0.66 - 12, 16 + rank * 12);
  const arcs = ranked
    .map((o, rank) => {
      const a = pos.get(`a:${agentKey(o.sides[0])}`);
      const b = pos.get(`a:${agentKey(o.sides[1])}`);
      if (!a || !b) return null;
      const [top, bottom] = a.y <= b.y ? [a, b] : [b, a];
      const x = top.x + nodeW;
      const y1 = top.y + NODE_H / 2 - (a === b ? 12 : 6);
      const y2 = bottom.y + NODE_H / 2 + (a === b ? 12 : 6);
      const ox = x + reach(rank);
      const r = Math.min(R / 2 + 2, (y2 - y1) / 2, ox - x);
      const d = `M${x} ${y1}H${ox - r}Q${ox} ${y1} ${ox} ${y1 + r}V${y2 - r}Q${ox} ${y2} ${ox - r} ${y2}H${x}`;
      return { o, d, apex: { x: ox, y: (y1 + y2) / 2 } };
    })
    .filter(
      (a): a is { o: Overlap; d: string; apex: { x: number; y: number } } =>
        a !== null,
    );

  const blind = overlaps.filter(
    (o) => o.communication === "not_observed",
  ).length;

  return (
    <section className="mp" aria-label="How the work flows">
      <div className="mp__top">
        <h2 className="o2-h">How the work flows</h2>
        <div
          className="o2-seg mp__weight"
          role="tablist"
          aria-label="Figures in"
        >
          {(["tokens", "sessions"] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="tab"
              data-slot="o2-seg"
              aria-selected={weight === w}
              onClick={() => setWeight(w)}
            >
              {w === "tokens" ? "Tokens" : "Sessions"}
            </button>
          ))}
        </div>
      </div>
      {/* The map sits on its own stage: a light gray, dotted layer */}
      <div className="mp-stage">
        <div className="mp__heads" aria-hidden="true">
          {COLUMNS.map((c, i) => (
            <span key={c.id} style={{ left: i * (nodeW + gapX), width: nodeW }}>
              {c.label}
            </span>
          ))}
        </div>

        <div
          ref={box}
          className="mp__canvas"
          style={{ height }}
          data-focus={focus ? "" : undefined}
          onMouseLeave={() => setHover(null)}
        >
          <svg
            className="mp__links"
            width={width}
            height={height}
            aria-hidden="true"
          >
            {/* Lit lines last, so they run on top of the ones that step back */}
            {[...links]
              .sort((a, b) => Number(lit(a.sessions)) - Number(lit(b.sessions)))
              .map((l) => {
                const a = pos.get(l.from);
                const b = pos.get(l.to);
                if (!a || !b) return null;
                const x1 = a.x + nodeW;
                const on = lit(l.sessions);
                return (
                  <path
                    key={`${l.from}>${l.to}`}
                    className="mp__link"
                    data-on={focus && on ? "" : undefined}
                    data-off={focus && !on ? "" : undefined}
                    d={elbow(
                      x1,
                      a.y + NODE_H / 2,
                      b.x,
                      b.y + NODE_H / 2,
                      trunk(l.from, x1),
                    )}
                  />
                );
              })}
            {arcs.map(({ o, d }) => {
              const on =
                !focus ||
                focus.key === `ov:${o.id}` ||
                o.sides.some((s) => focus.sessions.has(s.id));
              return (
                <g
                  key={o.id}
                  className="mp__arc"
                  data-cat={o.category}
                  data-off={focus && !on ? "" : undefined}
                  data-picked={pickedId === `ov:${o.id}` || undefined}
                >
                  <path
                    className="mp__arc-line"
                    d={d}
                    strokeDasharray={
                      o.communication === "observed"
                        ? undefined
                        : o.communication === "not_observed"
                          ? "3 4"
                          : "1 4"
                    }
                  />
                </g>
              );
            })}
            {/* One hollow dot where a card's connectors leave it */}
            {[...new Set(links.map((l) => l.from))].map((id) => {
              const p = pos.get(id);
              if (!p) return null;
              const on = lit(
                links.filter((l) => l.from === id).flatMap((l) => l.sessions),
              );
              return (
                <circle
                  key={id}
                  className="mp__dot"
                  data-on={focus && on ? "" : undefined}
                  data-off={focus && !on ? "" : undefined}
                  cx={p.x + nodeW}
                  cy={p.y + NODE_H / 2}
                  r={3.5}
                />
              );
            })}
          </svg>

          {COLUMNS.flatMap((c) =>
            columns[c.id].map((n) => {
              const p = pos.get(n.id)!;
              const on = lit(n.sessions);
              const opens =
                n.col === "initiative" &&
                data.initiatives.some((i) => `i:${i.id}` === n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  data-slot="mp-node"
                  className="mp__node"
                  data-col={n.col}
                  data-off={focus && !on ? "" : undefined}
                  data-held={held?.key === n.id || undefined}
                  aria-pressed={pickedId === n.id}
                  style={{ left: p.x, top: p.y, width: nodeW, height: NODE_H }}
                  onMouseEnter={() => setHover(focusOn(n.id, n.sessions))}
                  onFocus={() => setHover(focusOn(n.id, n.sessions))}
                  onBlur={() => setHover(null)}
                  onClick={() => {
                    if (opens) {
                      setHeld(null);
                      onPick({ kind: "initiative", id: n.id.slice(2) });
                    } else
                      setHeld(
                        held?.key === n.id ? null : focusOn(n.id, n.sessions),
                      );
                  }}
                >
                  {n.lead}
                  <span className="mp__text">
                    <span className="mp__label">{n.label}</span>
                    <span className="mp__meta">{n.meta}</span>
                  </span>
                </button>
              );
            }),
          )}

          {/* Each overlap's marker sits on its arc: point at it for both sides, click to open it */}
          {arcs.map(({ o, apex }) => {
            const Icon = KIND_ICONS[o.kind];
            const sides = o.sides.map((s) => s.id);
            return (
              <button
                key={o.id}
                type="button"
                data-slot="mp-overlap"
                className="mp__overlap"
                data-cat={o.category}
                data-off={
                  focus &&
                  focus.key !== `ov:${o.id}` &&
                  !sides.some((id) => focus.sessions.has(id))
                    ? ""
                    : undefined
                }
                aria-pressed={pickedId === `ov:${o.id}`}
                aria-label={o.title}
                data-tip={o.title}
                style={{ left: apex.x, top: apex.y }}
                onMouseEnter={() =>
                  setHover({ key: `ov:${o.id}`, sessions: new Set(sides) })
                }
                onFocus={() =>
                  setHover({ key: `ov:${o.id}`, sessions: new Set(sides) })
                }
                onBlur={() => setHover(null)}
                onClick={() => {
                  setHeld(null);
                  onPick({ kind: "overlap", id: o.id });
                }}
              >
                <Icon size={12} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mp__key">
        <li>
          <span className="mp__key-line" /> Works on, leads to
        </li>
        <li>
          <span className="mp__key-arc" /> Overlap, the agents talked
        </li>
        <li>
          <span className="mp__key-arc mp__key-arc--blind" /> Overlap, worked
          blind{blind ? ` (${blind})` : ""}
        </li>
        {overlaps.some((o) => o.communication === "unknown") && (
          <li>
            <span className="mp__key-arc mp__key-arc--unknown" /> Overlap, not
            known if they talked
          </li>
        )}
        <li className="o2-muted">
          Point at anything to follow its path · click to hold it
        </li>
      </ul>
    </section>
  );
}

function Lede({ data }: { data: Overview }) {
  const sessions = data.initiatives.length
    ? data.initiatives.flatMap((i) => i.sessions)
    : data.projects.flatMap((p) => p.sessions);
  const people = new Set(sessions.map(personKey)).size;
  const agents = new Set(sessions.map(agentKey)).size;
  const work = data.initiatives.length || data.projects.length;
  const blind = data.overlaps.filter(
    (o) => o.communication === "not_observed",
  ).length;
  return (
    <section className="o2-hero" aria-label="Summary">
      <p className="o2-eyebrow">
        {data.org} · {data.workspace}
      </p>
      <h2 className="o2-headline">
        {people} {people === 1 ? "person" : "people"}, {agents} agents, {work}{" "}
        {data.initiatives.length ? "initiatives" : "projects"}
        {data.overlaps.length
          ? ` – ${blind ? `${blind} of ${data.overlaps.length} overlaps happened without the agents talking` : "every overlap was talked through"}.`
          : " – no overlaps."}
      </h2>
      <p className="o2-sub">
        Who works where, through which agents, and what came out of it
      </p>
    </section>
  );
}

/** The frame every Map version shares: same summary, same panel; the version draws the map itself */
export function MapShell({
  scenario,
  children,
}: {
  scenario: ScenarioId;
  children: (
    data: Overview,
    pick: Pick | null,
    onPick: (p: Pick) => void,
  ) => ReactNode;
}) {
  return (
    <Frame
      scenario={scenario}
      page="map"
      title="Map"
      className="o2 mp-page"
      idle={{
        title: "This week",
        render: (data, onPick) => <MapWeekPanel data={data} onPick={onPick} />,
      }}
      detail={{
        initiative: (item, tab, onSession) => (
          <InitiativeDetail item={item} tab={tab} onSession={onSession} />
        ),
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {(data, pick, onPick) =>
        data.analysis === "empty" ? (
          <div className="o2-empty">
            <h2>No recorded work yet</h2>
            <p>
              Once agents record work, this page draws who works where and what
              came out of it.
            </p>
          </div>
        ) : (
          <>
            <Lede data={data} />
            {children(data, pick, onPick)}
          </>
        )
      }
    </Frame>
  );
}

/** v1 Flow: people → agents → initiatives → outcome */
export function MapPage({ scenario }: { scenario: ScenarioId }) {
  return (
    <MapShell scenario={scenario}>
      {(data, pick, onPick) => (
        <FlowMap data={data} pick={pick} onPick={onPick} />
      )}
    </MapShell>
  );
}

/* ---------- The Map page's side panel while nothing is picked ---------- */

/** Up to three people as overlapping initials */
function Faces({ names }: { names: string[] }) {
  return (
    <span className="mpp-faces" aria-hidden="true">
      {names.slice(0, 3).map((n) => (
        <Initials key={n} name={n} />
      ))}
    </span>
  );
}

/**
 * The map's structure as lists: how well the overlaps were coordinated, which people should talk,
 * who is on each initiative (flagging one-person and crowded ones), and what each person runs.
 * The map draws these; the panel names them so they can be read and acted on.
 */
function MapWeekPanel({ data, onPick }: { data: Overview; onPick: (p: Pick) => void }) {
  if (data.analysis === "empty")
    return (
      <div className="o-pane__empty o-week__empty">
        <p>Nothing recorded in this period.</p>
      </div>
    );
  const works = data.initiatives.length
    ? data.initiatives.map((i) => ({ id: i.id, name: i.name, sessions: i.sessions, opens: true }))
    : data.projects.map((p) => ({ id: p.name, name: p.name, sessions: p.sessions, opens: false }));
  const sessions = works.flatMap((w) => w.sessions);
  const people = [...new Map(sessions.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()];
  const agents = new Set(sessions.map(agentKey)).size;
  const talked = data.overlaps.filter((o) => o.communication === "observed").length;
  const blind = data.overlaps.filter((o) => o.communication === "not_observed");
  const unknown = data.overlaps.length - talked - blind.length;
  const names = (list: SessionItem[]) => [...new Set(list.flatMap((s) => (s.person ? [s.person.name] : [])))];
  const row = (key: string, lead: ReactNode, title: ReactNode, meta: string, trail: ReactNode, onClick?: () => void) => (
    <li key={key}>
      <button type="button" data-slot="o-activity" className="o-activity__row ov-recent mpp-row" disabled={!onClick} onClick={onClick}>
        {lead}
        <span className="o-activity__text">
          <span className="o-activity__title">{title}</span>
          <span className="o-activity__meta">{meta}</span>
        </span>
        {trail}
      </button>
    </li>
  );

  return (
    <div className="o-week">
      <section className="o-card" aria-label="Properties">
        <h3 className="o-card__title">Properties</h3>
        <dl className="o-props">
          <dt>Period</dt>
          <dd>
            <CalendarDays size={14} aria-hidden="true" /> {data.period.label}
          </dd>
          <dt>On the map</dt>
          <dd>
            <Users size={14} aria-hidden="true" /> {people.length} people, {agents} agents, {works.length} {data.initiatives.length ? "initiatives" : "projects"}
          </dd>
          <dt>Overlaps</dt>
          <dd>
            <GitCompareArrows size={14} aria-hidden="true" /> {data.overlaps.length}
          </dd>
          <dt>Coordination</dt>
          <dd className="o-props__stack">
            {data.overlaps.length ? (
              <>
                {talked > 0 && (
                  <span>
                    <span className="mpp-line" data-kind="talked" aria-hidden="true" /> {talked} talked it through
                  </span>
                )}
                {blind.length > 0 && (
                  <span>
                    <span className="mpp-line" data-kind="blind" aria-hidden="true" /> {blind.length} worked blind
                  </span>
                )}
                {unknown > 0 && (
                  <span>
                    <span className="mpp-line" data-kind="unknown" aria-hidden="true" /> {unknown} not known
                  </span>
                )}
              </>
            ) : (
              <span>No overlaps</span>
            )}
          </dd>
        </dl>
      </section>

      <section className="o-card" aria-label="Should talk">
        <h3 className="o-card__title">Should talk</h3>
        {blind.length ? (
          <ul className="o-activity">
            {blind.map((o) => {
              const who = [...new Set(o.sides.map((s) => s.person?.name ?? "Unknown"))];
              return row(
                o.id,
                <span className="o-cat__dot" data-cat={o.category} aria-hidden="true" />,
                who.length > 1 ? who.map(first).join(" & ") : `${first(who[0]!)}, with an earlier run`,
                `${o.title} · ${o.initiative ?? "no initiative"}`,
                <Faces names={who} />,
                () => onPick({ kind: "overlap", id: o.id }),
              );
            })}
          </ul>
        ) : (
          <p className="o-card__text">Nobody collided without talking in this period.</p>
        )}
      </section>

      <section className="o-card" aria-label="Who is on each initiative">
        <h3 className="o-card__title">Who is on each initiative</h3>
        <ul className="o-activity">
          {works
            .filter((w) => w.sessions.length)
            .map((w) => {
              const who = names(w.sessions);
              const n = new Set(w.sessions.map(agentKey)).size;
              const flag = who.length === 1 ? "One person" : n >= 3 ? "Crowded" : null;
              return row(
                w.id,
                <FolderOpen size={14} aria-hidden="true" className="o-lead-icon" />,
                <>
                  {w.name}
                  {flag && <span className="mpp-flag"> · {flag}</span>}
                </>,
                `${n} ${n === 1 ? "agent" : "agents"} · ${who.map(first).join(", ")}`,
                <Faces names={who} />,
                w.opens ? () => onPick({ kind: "initiative", id: w.id }) : undefined,
              );
            })}
        </ul>
      </section>

      <section className="o-card" aria-label="What each person runs">
        <h3 className="o-card__title">What each person runs</h3>
        <ul className="o-activity">
          {people.map((p) => {
            const mine = sessions.filter((s) => s.person?.id === p.id);
            const sources = [...new Set(mine.map((s) => s.source))];
            const on = works.filter((w) => w.sessions.some((s) => s.person?.id === p.id)).length;
            return row(
              p.id,
              <Initials name={p.name} />,
              p.name,
              `${sources.map(harness).join(" & ")} · on ${on} ${on === 1 ? "initiative" : "initiatives"}`,
              <span className="mpp-logos" aria-hidden="true">
                {sources.map((src) => (
                  <HarnessLogo key={src} source={src} />
                ))}
              </span>,
            );
          })}
        </ul>
      </section>
    </div>
  );
}
