// Two more ways to draw the Map, with the same connectors as the affectUI Agent Tree (thin soft blue,
// right-angled with rounded corners, a hollow dot where they leave a card):
//   v2 Trees – one tree per initiative: the initiative on top, its agents hanging below; overlaps between
//              them as brackets under the cards. Answers "who is on what, and does it rest on one person?"
//   v3 Pairs – every pair of agents that has to coordinate because they work on the same thing, as two
//              cards joined by a connector – the ones that worked blind first. Answers "who must talk to
//              whom, and did they?"
import { useLayoutEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { ScenarioId } from "../scenarios";
import { formatTokens, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";
import { KIND_ICONS } from "./OverlapPanel";
import type { Overlap } from "./overlaps";
import {
  agentKey,
  first,
  group,
  harness,
  MapShell,
  OUTCOMES,
  outcomeOf,
} from "./MapPage";
import { HarnessLogo, Initials } from "./WeekPanel";

type Agent = {
  key: string;
  source: string;
  person: string | null;
  sessions: SessionItem[];
};
type Work = {
  id: string;
  name: string;
  sessions: SessionItem[];
  health: "on-track" | "at-risk" | null;
  opens: boolean;
};

const workOf = (data: Overview): Work[] =>
  data.initiatives.length
    ? data.initiatives.map((i) => ({
        id: i.id,
        name: i.name,
        sessions: i.sessions,
        health: i.health,
        opens: true,
      }))
    : data.projects.map((p) => ({
        id: p.name,
        name: p.name,
        sessions: p.sessions,
        health: null,
        opens: false,
      }));
const agentsOf = (sessions: SessionItem[]): Agent[] =>
  [...group(sessions, agentKey)].map(([key, list]) => ({
    key,
    source: list[0]!.source,
    person: list[0]!.person?.name ?? null,
    sessions: list,
  }));
const tokensOf = (list: SessionItem[]) =>
  list.reduce((a, s) => a + (s.tokens ?? 0), 0);
const owner = (a: Agent) => (a.person ? `${first(a.person)}'s` : "Unknown");
const sessionsLabel = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;
const dash = (o: Overlap) =>
  o.communication === "observed"
    ? undefined
    : o.communication === "not_observed"
      ? "3 4"
      : "1 4";

/** An agent's face: the person's initials with the harness logo tucked against them */
function AgentMark({ a }: { a: Agent }) {
  return (
    <span className="mx-mark" aria-hidden="true">
      {a.person ? <Initials name={a.person} /> : null}
      <HarnessLogo source={a.source} />
    </span>
  );
}

/** Finished / running / paused as small colored dots with their counts */
function Outcomes({ sessions }: { sessions: SessionItem[] }) {
  return (
    <span className="mx-outcomes">
      {OUTCOMES.map((o) => {
        const n = sessions.filter((s) => outcomeOf(s) === o.id).length;
        return n ? (
          <span key={o.id} title={o.label}>
            <span className="mx-outcomes__dot" data-outcome={o.id} /> {n}
          </span>
        ) : null;
      })}
    </span>
  );
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.round(e!.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/* ---------- v2 Trees ---------- */

const ROOT_W = 280;
const ROOT_H = 56;
const DROP = 44;
const CARD_H = 68;
const CARD_GAP = 16;
const R = 8;

function Tree({
  work,
  overlaps,
  pick,
  onPick,
}: {
  work: Work;
  overlaps: Overlap[];
  pick: Pick | null;
  onPick: (p: Pick) => void;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<Set<string> | null>(null);
  const agents = agentsOf(work.sessions).sort(
    (a, b) => tokensOf(b.sessions) - tokensOf(a.sessions),
  );
  const n = agents.length;
  const cardW = Math.max(
    140,
    Math.min(220, (width - (n - 1) * CARD_GAP) / Math.max(1, n)),
  );
  const rootW = Math.min(ROOT_W, width);
  const rowW = n * cardW + (n - 1) * CARD_GAP;
  const left = Math.max(0, (width - rowW) / 2);
  const x = (i: number) => left + i * (cardW + CARD_GAP);
  const rootX = (width - rootW) / 2;
  const cardY = ROOT_H + DROP;
  const bottom = cardY + CARD_H;
  const people = new Set(agents.map((a) => a.person)).size;

  // Overlaps whose sides are both agents of this tree, met in this initiative's sessions
  const ids = new Set(work.sessions.map((s) => s.id));
  const mine = overlaps.filter(
    (o) =>
      o.sides.some((s) => ids.has(s.id)) &&
      o.sides.every((s) => agents.some((a) => a.key === agentKey(s))),
  );
  const at = (key: string) => agents.findIndex((a) => a.key === key);
  const brackets = mine
    .map((o) => {
      const i = at(agentKey(o.sides[0]));
      const j = at(agentKey(o.sides[1]));
      return { o, lo: Math.min(i, j), hi: Math.max(i, j) };
    })
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo))
    .map((b, rank) => {
      const depth = 18 + rank * 14;
      const cx = (i: number) => x(i) + cardW / 2;
      const x1 = b.lo === b.hi ? cx(b.lo) - 24 : cx(b.lo);
      const x2 = b.lo === b.hi ? cx(b.hi) + 24 : cx(b.hi);
      const y = bottom + depth;
      const r = Math.min(R, (x2 - x1) / 2, depth / 2);
      return {
        ...b,
        y,
        mid: (x1 + x2) / 2,
        d: `M${x1} ${bottom}V${y - r}Q${x1} ${y} ${x1 + r} ${y}H${x2 - r}Q${x2} ${y} ${x2} ${y - r}V${bottom}`,
      };
    });
  const height =
    bottom + (brackets.length ? 18 + (brackets.length - 1) * 14 + 16 : 4);

  // Stem down from the root, a bar along, a rounded drop into each card – the Agent Tree's first level
  const sx = width / 2;
  const sy = ROOT_H;
  const mid = sy + DROP / 2;
  const drops = agents.map((a, i) => {
    const x2 = x(i) + cardW / 2;
    const dx = x2 - sx;
    if (Math.abs(dx) < 12) return { key: a.key, d: `M${sx} ${sy}V${cardY}` };
    const sg = Math.sign(dx);
    const r = Math.min(R, Math.abs(dx) / 2, (cardY - mid) / 2);
    return {
      key: a.key,
      d: `M${sx} ${sy}V${mid - r}Q${sx} ${mid} ${sx + sg * r} ${mid}H${x2 - sg * r}Q${x2} ${mid} ${x2} ${mid + r}V${cardY}`,
    };
  });
  const lit = (key: string) => !hover || hover.has(key);

  return (
    <div
      ref={ref}
      className="mt"
      style={{ height }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        className="mp__links"
        width={width}
        height={height}
        aria-hidden="true"
      >
        {[...drops]
          .sort((a, b) => Number(lit(a.key)) - Number(lit(b.key)))
          .map((d) => (
            <path
              key={d.key}
              className="mp__link"
              data-on={hover && lit(d.key) ? "" : undefined}
              data-off={hover && !lit(d.key) ? "" : undefined}
              d={d.d}
            />
          ))}
        {brackets.map((b) => (
          <g
            key={b.o.id}
            className="mp__arc"
            data-cat={b.o.category}
            data-off={
              hover && !b.o.sides.every((s) => hover.has(agentKey(s)))
                ? ""
                : undefined
            }
          >
            <path
              className="mp__arc-line"
              d={b.d}
              strokeDasharray={dash(b.o)}
            />
          </g>
        ))}
        <circle className="mp__dot" cx={sx} cy={sy} r={3.5} />
      </svg>

      <button
        type="button"
        data-slot="mp-node"
        className="mp__node mt__root"
        aria-pressed={pick?.kind === "initiative" && pick.id === work.id}
        disabled={!work.opens}
        style={{ left: rootX, top: 0, width: rootW, height: ROOT_H }}
        onMouseEnter={() => setHover(null)}
        onClick={() => onPick({ kind: "initiative", id: work.id })}
      >
        <FolderOpen size={16} aria-hidden="true" className="o-lead-icon" />
        <span className="mp__text">
          <span className="mp__label">{work.name}</span>
          <span className="mp__meta">
            {n} {n === 1 ? "agent" : "agents"} ·{" "}
            {formatTokens(tokensOf(work.sessions))} tokens
            {people === 1 ? " · one person" : ""}
          </span>
        </span>
        {work.health === "at-risk" && <span className="mt__risk">At risk</span>}
      </button>

      {agents.map((a, i) => {
        const latest = [...a.sessions].sort(
          (p, q) => Date.parse(q.lastTs) - Date.parse(p.lastTs),
        )[0]!;
        return (
          <button
            key={a.key}
            type="button"
            data-slot="mp-node"
            className="mp__node mt__agent"
            data-off={hover && !lit(a.key) ? "" : undefined}
            aria-pressed={
              pick?.kind === "session" &&
              a.sessions.some((s) => s.id === pick.id)
            }
            style={{ left: x(i), top: cardY, width: cardW, height: CARD_H }}
            onMouseEnter={() => setHover(new Set([a.key]))}
            onClick={() =>
              onPick({
                kind: "session",
                id: latest.id,
                from: work.opens ? work.id : null,
              })
            }
            title={`Opens ${owner(a)} latest session`}
          >
            <AgentMark a={a} />
            <span className="mp__text">
              <span className="mp__label">{harness(a.source)}</span>
              <span className="mp__meta">
                {a.person ? first(a.person) : "Unknown"} ·{" "}
                {sessionsLabel(a.sessions.length)} ·{" "}
                {formatTokens(tokensOf(a.sessions))}
              </span>
              <Outcomes sessions={a.sessions} />
            </span>
          </button>
        );
      })}

      {brackets.map((b) => {
        const Icon = KIND_ICONS[b.o.kind];
        const keys = new Set(b.o.sides.map(agentKey));
        return (
          <button
            key={b.o.id}
            type="button"
            data-slot="mp-overlap"
            className="mp__overlap"
            data-cat={b.o.category}
            data-off={
              hover && ![...keys].every((k) => hover.has(k)) ? "" : undefined
            }
            aria-pressed={pick?.kind === "overlap" && pick.id === b.o.id}
            aria-label={b.o.title}
            data-tip={b.o.title}
            style={{ left: b.mid, top: b.y }}
            onMouseEnter={() => setHover(keys)}
            onClick={() => onPick({ kind: "overlap", id: b.o.id })}
          >
            <Icon size={12} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function Key({ data }: { data: Overview }) {
  const blind = data.overlaps.filter(
    (o) => o.communication === "not_observed",
  ).length;
  return (
    <ul className="mp__key">
      <li>
        <span className="mp__key-arc" /> Overlap, the agents talked
      </li>
      <li>
        <span className="mp__key-arc mp__key-arc--blind" /> Overlap, worked
        blind{blind ? ` (${blind})` : ""}
      </li>
      {data.overlaps.some((o) => o.communication === "unknown") && (
        <li>
          <span className="mp__key-arc mp__key-arc--unknown" /> Not known if
          they talked
        </li>
      )}
      <li className="mx-key-outcomes">
        {OUTCOMES.map((o) => (
          <span key={o.id}>
            <span className="mx-outcomes__dot" data-outcome={o.id} /> {o.label}
          </span>
        ))}
      </li>
    </ul>
  );
}

export function MapTrees({ scenario }: { scenario: ScenarioId }) {
  return (
    <MapShell scenario={scenario}>
      {(data, pick, onPick) => (
        <section className="mp" aria-label="Initiatives and their agents">
          <h2 className="o2-h">Who works on what</h2>
          <div className="mp-stage mt-list">
            {workOf(data)
              .filter((w) => w.sessions.length)
              .map((w) => (
                <Tree
                  key={w.id}
                  work={w}
                  overlaps={data.overlaps}
                  pick={pick}
                  onPick={onPick}
                />
              ))}
          </div>
          <Key data={data} />
        </section>
      )}
    </MapShell>
  );
}

/* ---------- v3 Pairs ---------- */

type Status = "blind" | "unknown" | "talked" | "clear";
const STATUS: Record<Status, { title: string; label: string; note: string }> = {
  blind: {
    title: "Worked blind",
    label: "Didn't talk",
    note: "They collided and there's no sign they talked over the relay.",
  },
  unknown: {
    title: "Not known",
    label: "Unknown",
    note: "They collided; whether they talked isn't recorded.",
  },
  talked: {
    title: "Talked it through",
    label: "Talked",
    note: "They collided and sorted it out over the relay.",
  },
  clear: {
    title: "Side by side, no collision",
    label: "No collision",
    note: "Same initiative, no overlap found – worth knowing, nothing to do.",
  },
};
const ORDER: Status[] = ["blind", "unknown", "talked", "clear"];

type Pair = {
  key: string;
  a: Agent;
  b: Agent;
  shared: Work[];
  overlaps: Overlap[];
  status: Status;
};

function pairsOf(data: Overview): Pair[] {
  const works = workOf(data);
  const agents = new Map(
    agentsOf(works.flatMap((w) => w.sessions)).map((a) => [a.key, a]),
  );
  const pairs = new Map<string, Pair>();
  const at = (k1: string, k2: string) => {
    const [x, y] = [k1, k2].sort() as [string, string];
    const key = `${x}|${y}`;
    if (!pairs.has(key) && agents.has(x) && agents.has(y))
      pairs.set(key, {
        key,
        a: agents.get(x)!,
        b: agents.get(y)!,
        shared: [],
        overlaps: [],
        status: "clear",
      });
    return pairs.get(key);
  };
  for (const w of works) {
    const keys = [...new Set(w.sessions.map(agentKey))];
    keys.forEach((k1, i) =>
      keys.slice(i + 1).forEach((k2) => at(k1, k2)?.shared.push(w)),
    );
  }
  for (const o of data.overlaps) {
    const p = at(agentKey(o.sides[0]), agentKey(o.sides[1]));
    if (!p) continue;
    p.overlaps.push(o);
    const w = works.find((x) => x.sessions.some((s) => s.id === o.sides[0].id));
    if (w && !p.shared.includes(w)) p.shared.push(w);
  }
  for (const p of pairs.values())
    p.status = p.overlaps.some((o) => o.communication === "not_observed")
      ? "blind"
      : p.overlaps.some((o) => o.communication === "unknown")
        ? "unknown"
        : p.overlaps.length
          ? "talked"
          : "clear";
  return [...pairs.values()].sort(
    (x, y) =>
      tokensOf([...y.a.sessions, ...y.b.sessions]) -
      tokensOf([...x.a.sessions, ...x.b.sessions]),
  );
}

function AgentCard({ a }: { a: Agent }) {
  return (
    <span className="mx-card">
      <AgentMark a={a} />
      <span className="mp__text">
        <span className="mp__label">
          {owner(a)} {harness(a.source)}
        </span>
        <span className="mp__meta">
          {sessionsLabel(a.sessions.length)} ·{" "}
          {formatTokens(tokensOf(a.sessions))}
        </span>
      </span>
    </span>
  );
}

function PairRow({
  p,
  pick,
  onPick,
}: {
  p: Pair;
  pick: Pick | null;
  onPick: (p: Pick) => void;
}) {
  const o = p.overlaps[0];
  const Icon = o ? KIND_ICONS[o.kind] : null;
  const opens = o
    ? { kind: "overlap" as const, id: o.id }
    : p.shared[0]?.opens
      ? { kind: "initiative" as const, id: p.shared[0].id }
      : null;
  const picked = !!opens && pick?.kind === opens.kind && pick.id === opens.id;
  const self = p.a.key === p.b.key;
  return (
    <li>
      <button
        type="button"
        data-slot="mx-pair"
        className="mx-pair"
        data-status={p.status}
        aria-pressed={picked}
        disabled={!opens}
        onClick={() => opens && onPick(opens)}
      >
        <AgentCard a={p.a} />
        <span className="mx-link">
          <svg
            className="mx-link__line"
            aria-hidden="true"
            preserveAspectRatio="none"
            viewBox="0 0 100 10"
          >
            <line
              x1="0"
              y1="5"
              x2="100"
              y2="5"
              strokeDasharray={o ? dash(o) : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="mx-link__dot mx-link__dot--start" />
          <span className="mx-link__dot mx-link__dot--end" />
          <span className="mx-link__label">
            <span className="mx-tag" data-status={p.status}>
              {Icon && <Icon size={12} aria-hidden="true" />}
              {o
                ? p.overlaps.length > 1
                  ? `${p.overlaps.length} overlaps · ${STATUS[p.status].label}`
                  : o.kindLabel
                : STATUS.clear.label}
            </span>
            <span className="mx-link__on">
              {p.shared.map((w) => w.name).join(" · ") ||
                "Different initiatives"}
            </span>
          </span>
        </span>
        {self ? (
          <span className="mx-card mx-card--self">
            <span className="mp__text">
              <span className="mp__label">The same agent</span>
              <span className="mp__meta">ran into its own earlier work</span>
            </span>
          </span>
        ) : (
          <AgentCard a={p.b} />
        )}
      </button>
    </li>
  );
}

export function MapPairs({ scenario }: { scenario: ScenarioId }) {
  return (
    <MapShell scenario={scenario}>
      {(data, pick, onPick) => {
        const pairs = pairsOf(data);
        return (
          <section className="mp" aria-label="Who has to coordinate with whom">
            <h2 className="o2-h">Who has to coordinate with whom</h2>
            <div className="mp-stage mx-stage">
              {pairs.length ? (
                ORDER.map((st) => {
                  const list = pairs.filter((p) => p.status === st);
                  return list.length ? (
                    <div key={st} className="mx-group">
                      <div className="mx-group__head">
                        <span className="mx-tag" data-status={st}>
                          {STATUS[st].title} · {list.length}
                        </span>
                        <span className="o2-muted">{STATUS[st].note}</span>
                      </div>
                      <ul className="mx-pairs">
                        {list.map((p) => (
                          <PairRow
                            key={p.key}
                            p={p}
                            pick={pick}
                            onPick={onPick}
                          />
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })
              ) : (
                <p className="o2-muted">
                  Every initiative has one agent on it – nobody has to
                  coordinate.
                </p>
              )}
            </div>
          </section>
        );
      }}
    </MapShell>
  );
}
