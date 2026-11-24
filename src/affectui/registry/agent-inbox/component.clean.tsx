"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Columns2, List, LoaderCircle, Search, Sparkles, TriangleAlert, Wrench } from "lucide-react";

/*
 * Agent Inbox – every background task your agents are working on, as a calm board, in a single self-contained file.
 * Tasks sit in soft gray columns – Needs you, Running, Done – as white cards: a status glyph and the title,
 * two lines on what the agent is doing, and a quiet footer with the state ("Waiting for you", "Running · 2m 14s")
 * and how many tools and sources it used.
 *   · click a card and it unfolds in place: the last steps as a tiny timeline, and what you can do now –
 *     Approve / Reject when it waits, Retry when it failed, Open when it runs or is done
 *   · a card that changes state shows it in place first, then glides over to its new column
 *   · Board / List switches the layout; narrow containers always get the list
 * The styles are injected below, so no extra files are needed.
 */

export type AgentTaskStatus = "running" | "waiting" | "done" | "failed";

export type AgentTaskStep = {
  label: string;
  /** Ready-to-show time, e.g. "2m ago" or "14:02" */
  time?: string;
};

export type AgentTask = {
  id: string;
  title: string;
  /** One or two sentences on what the task is about or where it stands */
  description?: string;
  /** Name of the agent or model, e.g. "Opus 5.5" */
  agent: string;
  /** Shown in the open card instead of `agent` – e.g. the same words with a photo and a logo */
  agentLine?: ReactNode;
  status: AgentTaskStatus;
  /** When the task started – the clock ticks from here while it runs or waits */
  startedAt?: number | Date;
  /** How long it took in ms – shown for done and failed tasks */
  elapsed?: number;
  /** Tool calls so far – shown with a small wrench */
  tools?: number;
  /** Sources or files read – shown with a small magnifier */
  sources?: number;
  /** What the agent did so far, oldest first – the last four are shown when the card is open */
  steps?: AgentTaskStep[];
};

export type AgentInboxView = "board" | "list";

export type AgentInboxProps = {
  tasks: AgentTask[];
  /** With a handler the inbox shows exactly the tasks you pass; without one it changes the status on its own */
  onApprove?: (task: AgentTask) => void;
  onReject?: (task: AgentTask) => void;
  onRetry?: (task: AgentTask) => void;
  /** Shows an Open button on running and done tasks */
  onOpen?: (task: AgentTask) => void;
  /** Heading on the left of the bar */
  title?: string;
  /** Controlled layout */
  view?: AgentInboxView;
  defaultView?: AgentInboxView;
  onViewChange?: (view: AgentInboxView) => void;
  /** Which lanes show – e.g. ["needs"] for just what needs you; defaults to all three */
  lanes?: AgentInboxLane[];
  /** A task id to point at – the other cards fade; null or undefined for none */
  highlight?: string | null;
  className?: string;
};

/* ---------- Helpers ---------- */

export type AgentInboxLane = "needs" | "running" | "done";
type Lane = AgentInboxLane;
const LANES: { id: Lane; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "done", label: "Done" },
];
const laneOf = (s: AgentTaskStatus): Lane => (s === "waiting" || s === "failed" ? "needs" : s === "running" ? "running" : "done");
const STATE: Record<AgentTaskStatus, string> = { waiting: "Waiting for you", running: "Running", done: "Done", failed: "Failed" };
const live = (s: AgentTaskStatus) => s === "running" || s === "waiting";
/** An unknown status reads as running – the task still shows up, with a ticking clock */
const toStatus = (s: unknown): AgentTaskStatus => (s === "waiting" || s === "done" || s === "failed" ? s : "running");
/** A time as a number, a Date or an ISO string – NaN when it can't be read */
const ms = (d: unknown) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : typeof d === "string" ? Date.parse(d) : NaN);
/** A count or duration that can be shown: finite and not negative */
const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined);
/** A task as the inbox shows it: a key of its own even when ids repeat, a known status, and the task as you passed it */
type Item = AgentTask & { key: string; src: AgentTask };
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (time: number) => {
  if (!Number.isFinite(time)) return "—";
  const s = Math.max(0, Math.floor(time / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
// 18240 → "18.2K" on the card, the exact number in the tooltip
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en");

// One shared second for every running clock – only the clocks render again, not the whole inbox
const ticker = { subs: new Set<() => void>(), id: 0 };
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    ticker.subs.add(tick);
    if (!ticker.id) ticker.id = window.setInterval(() => ticker.subs.forEach((f) => f()), 1000);
    return () => {
      ticker.subs.delete(tick);
      if (!ticker.subs.size) {
        window.clearInterval(ticker.id);
        ticker.id = 0;
      }
    };
  }, [active]);
  return now;
};
/** Live tasks count up from `since`; finished ones show `fixed` */
const Clock = ({ since, fixed }: { since?: number; fixed: number }) => {
  const now = useNow(since !== undefined);
  return <>{clock(since !== undefined ? now - since : fixed)}</>;
};
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)";

/* ---------- Icons ---------- */

// Agent Relay: Lucide, the dashboard's one icon family (these were drawn by hand)
const Spark = () => <Sparkles size={14} aria-hidden="true" />;
const StateIcon = ({ status }: { status: AgentTaskStatus }) => (
  <span className="ui-aic__state-icon" data-status={status} aria-hidden="true">
    {status === "running" && <LoaderCircle size={12} />}
    {status === "waiting" && <TriangleAlert size={12} />}
    {status === "done" && <CircleCheck size={12} />}
    {status === "failed" && <CircleAlert size={12} />}
  </span>
);
const WrenchIcon = () => <Wrench size={12} aria-hidden="true" />;
const SearchIcon = () => <Search size={12} aria-hidden="true" />;
const BoardIcon = () => <Columns2 size={13} aria-hidden="true" />;
const ListIcon = () => <List size={13} aria-hidden="true" />;

export function AgentInbox({
  tasks,
  onApprove,
  onReject,
  onRetry,
  onOpen,
  title = "Agent inbox",
  view,
  defaultView = "board",
  onViewChange,
  lanes: shownLanes,
  highlight,
  className,
}: AgentInboxProps) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [innerView, setInnerView] = useState(defaultView);
  const layout = view ?? innerView;
  const [opened, setOpened] = useState<string | null>(null);

  // Without handlers the inbox runs the decisions itself
  const [local, setLocal] = useState<Record<string, { status: AgentTaskStatus; startedAt?: number; steps?: AgentTaskStep[] }>>({});
  // Gaps are skipped, a repeated id gets its own key, steps without a label are left out
  const ids = new Map<string, number>();
  const list: Item[] = (Array.isArray(tasks) ? tasks : [])
    .filter((t): t is AgentTask => !!t && typeof t === "object")
    .map((src) => {
      const id = String(src.id ?? "");
      const n = ids.get(id) ?? 0;
      ids.set(id, n + 1);
      const key = n ? `${id}#${n}` : id;
      const t = local[key] ? { ...src, ...local[key] } : src;
      const steps = (Array.isArray(t.steps) ? t.steps : [])
        .filter((x): x is AgentTaskStep => !!x && typeof x === "object" && String(x.label ?? "").trim() !== "")
        .map((x) => ({ label: String(x.label), time: x.time ? String(x.time) : undefined }));
      return { ...t, key, src, status: toStatus(t.status), title: String(t.title ?? "").trim() || "Untitled task", steps };
    });

  // Where a live task's clock counts from – without a readable startedAt, from when the inbox first saw it
  const seen = useRef<Record<string, number>>({});
  for (const t of list) seen.current[t.key] ??= Date.now();
  const sinceOf = (t: Item) => {
    if (!live(t.status)) return undefined;
    const start = ms(t.startedAt);
    return Number.isFinite(start) ? start : seen.current[t.key] - (whole(t.elapsed) ?? 0);
  };

  /* ---------- A changed card shows its new state in place, then moves to its new column ---------- */

  const [placed, setPlaced] = useState<Record<string, Lane>>(() => Object.fromEntries(list.map((t) => [t.key, laneOf(t.status)])));
  const laneKey = list.map((t) => `${t.key}:${laneOf(t.status)}`).join("|");
  useEffect(() => {
    const pending = list.some((t) => placed[t.key] !== laneOf(t.status));
    if (!pending) return;
    const timer = window.setTimeout(() => setPlaced(Object.fromEntries(list.map((t) => [t.key, laneOf(t.status)]))), reduced() ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [laneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const laneFor = (t: Item) => placed[t.key] ?? laneOf(t.status);

  // FLIP: remember where every card was, and glide from there after the move
  const cards = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, DOMRect>());
  const placedKey = JSON.stringify(placed) + layout;
  const lastKey = useRef(placedKey);
  // Only measure when a card is about to move – not on every render
  if (rootRef.current && lastKey.current !== placedKey) {
    before.current = new Map([...cards.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
  }
  useLayoutEffect(() => {
    if (lastKey.current === placedKey) return;
    lastKey.current = placedKey;
    if (reduced()) return;
    for (const [id, el] of cards.current) {
      const from = before.current.get(id);
      if (!from) {
        el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE });
        continue;
      }
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 2 }, { transform: "none", zIndex: 2 }], { duration: 560, easing: EASE });
    }
  }, [placedKey]);

  /* ---------- Decisions ---------- */

  const decide = (task: Item, next: AgentTaskStatus, note: string, handler?: (t: AgentTask) => void) => {
    if (handler) return handler(task.src);
    setLocal((l) => ({
      ...l,
      [task.key]: { status: next, startedAt: Date.now(), steps: [...(task.steps ?? []), { label: note, time: "now" }] },
    }));
  };
  const toggle = (id: string) => setOpened((o) => (o === id ? null : id));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && opened) {
      e.stopPropagation();
      cards.current.get(opened)?.querySelector<HTMLElement>(".ui-aic__card-main")?.focus({ preventScroll: true });
      setOpened(null);
    }
  };
  const setView = (v: AgentInboxView) => {
    setInnerView(v);
    onViewChange?.(v);
  };

  /* ---------- One card ---------- */

  const card = (t: Item) => {
    const isOpen = opened === t.key;
    const steps = (t.steps ?? []).slice(-4);
    const elapsed = whole(t.elapsed);
    // Done without a readable time just says Done
    const timed = t.status !== "failed" && (t.status !== "done" || elapsed !== undefined);
    const sources = whole(t.sources);
    const tools = whole(t.tools);
    const desc = typeof t.description === "string" ? t.description.trim() : "";
    const agent = String(t.agent ?? "").trim();
    const panel = `${uid}-${encodeURIComponent(t.key)}`;
    // The word goes first when a card is slim – the glyph already says it – so the time always fits
    const word = t.status === "done" ? (timed ? "Done in" : STATE.done) : t.status === "failed" ? STATE.failed : `${STATE[t.status]} ·`;
    return (
      <li
        key={t.key}
        data-id={t.id}
        className="ui-aic__card"
        data-faded={highlight && t.id !== highlight ? "" : undefined}
        data-status={t.status}
        data-open={isOpen ? "" : undefined}
        ref={(el) => {
          if (el) cards.current.set(t.key, el);
          else cards.current.delete(t.key);
        }}
      >
        <button type="button" className="ui-aic__card-main" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(t.key)}>
          <span className="ui-aic__title-row">
            <span className="ui-aic__spark">
              <Spark />
            </span>
            <span className="ui-aic__title" dir="auto" title={t.title}>
              {t.title}
            </span>
          </span>
          {desc && (
            <span className="ui-aic__desc" dir="auto">
              {desc}
            </span>
          )}
          <span className="ui-aic__foot">
            <span className="ui-aic__state" data-status={t.status} data-bare={timed ? undefined : ""}>
              <StateIcon status={t.status} />
              {/* The word may shorten, the time never does */}
              <span className="ui-aic__state-word">{word}</span>
              {timed && (
                <span className="ui-aic__time">
                  <Clock since={sinceOf(t)} fixed={elapsed ?? 0} />
                </span>
              )}
            </span>
            <span className="ui-aic__meta">
              {sources !== undefined && (
                <span title={`Sources read: ${exact.format(sources)}`}>
                  <SearchIcon />
                  {compact.format(sources)}
                </span>
              )}
              {tools !== undefined && (
                <span title={`Tool calls: ${exact.format(tools)}`}>
                  <WrenchIcon />
                  {compact.format(tools)}
                </span>
              )}
            </span>
          </span>
        </button>

        <div id={panel} className="ui-aic__fold" data-open={isOpen ? "" : undefined} inert={!isOpen}>
          <div className="ui-aic__clip">
            <div className="ui-aic__more">
              {(t.agentLine || agent) && <div className="ui-aic__agent" dir="auto">{t.agentLine ?? agent}</div>}
              {steps.length > 0 && (
                <ol className="ui-aic__steps">
                  {steps.map((s, i) => (
                    <li key={i} data-last={i === steps.length - 1 ? "" : undefined}>
                      <span dir="auto">{s.label}</span>
                      {s.time && <time dir="auto">{s.time}</time>}
                    </li>
                  ))}
                </ol>
              )}
              <div className="ui-aic__actions">
                {t.status === "waiting" && (
                  <>
                    <button type="button" className="ui-aic__btn" onClick={() => decide(t, "failed", "You rejected the request", onReject)}>
                      Reject
                    </button>
                    <button type="button" className="ui-aic__btn ui-aic__btn--primary" onClick={() => decide(t, "running", "You approved – continuing", onApprove)}>
                      Approve
                    </button>
                  </>
                )}
                {t.status === "failed" && (
                  <button type="button" className="ui-aic__btn ui-aic__btn--primary" onClick={() => decide(t, "running", "Retrying", onRetry)}>
                    Retry
                  </button>
                )}
                {(t.status === "running" || t.status === "done") && onOpen && (
                  <button type="button" className="ui-aic__btn" onClick={() => onOpen(t)}>
                    Open
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </li>
    );
  };

  // Big lanes read 999+, the exact number on hover
  const many = (n: number) => (n > 999 ? "999+" : String(n));
  const counts = Object.fromEntries(LANES.map((l) => [l.id, list.filter((t) => laneFor(t) === l.id).length])) as Record<Lane, number>;
  const needs = list.filter((t) => t.status === "waiting" || t.status === "failed").length;
  const summary = `${needs} ${needs === 1 ? "needs" : "need"} you, ${list.filter((t) => t.status === "running").length} running`;

  return (
    <div ref={rootRef} className={["ui-aic", className].filter(Boolean).join(" ")} data-view={layout} onKeyDown={onKeyDown}>
      <style href="ui-agent-inbox-clean" precedence="default">
        {css}
      </style>

      <div className="ui-aic__bar">
        <span className="ui-aic__heading">
          <span className="ui-aic__crumb">Agents</span>
          <span className="ui-aic__slash" aria-hidden="true">
            /
          </span>
          <span className="ui-aic__heading-title" title={title}>
            {title}
          </span>
        </span>
        {(view === undefined || onViewChange) && (
        <div className="ui-aic__views" role="radiogroup" aria-label="Layout">
          {(["board", "list"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={layout === v} className="ui-aic__view" onClick={() => setView(v)}>
              {v === "board" ? <BoardIcon /> : <ListIcon />}
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        )}
      </div>

      <div className="ui-aic__lanes">
        {LANES.filter((lane) => !shownLanes || shownLanes.includes(lane.id)).map((lane) => (
          <section key={lane.id} className="ui-aic__lane" aria-label={lane.label}>
            <header className="ui-aic__lane-head">
              <span className="ui-aic__lane-spark" aria-hidden="true">
                <Spark />
              </span>
              <span className="ui-aic__lane-name">{lane.label}</span>
              <span className="ui-aic__count" title={counts[lane.id] > 999 ? exact.format(counts[lane.id]) : undefined}>
                {many(counts[lane.id])}
              </span>
            </header>
            <ul className="ui-aic__cards">
              {list.filter((t) => laneFor(t) === lane.id).map(card)}
              {counts[lane.id] === 0 && <li className="ui-aic__empty">Nothing here</li>}
            </ul>
          </section>
        ))}
      </div>

      <span className="ui-aic__sr" aria-live="polite">
        {summary}
      </span>
    </div>
  );
}

const css = /* css */ `
.ui-aic {
  --ui-aic-lane: var(--aui-subtle, #f4f4f5);
  --ui-aic-card: var(--aui-surface, #ffffff);
  --ui-aic-line: var(--aui-border, #e9e9ec);
  --ui-aic-ink: var(--aui-ink, #1c1c1f);
  --ui-aic-text: var(--aui-muted, #55555c);
  --ui-aic-muted: var(--aui-muted, #8e8e96);
  --ui-aic-faint: #b4b4bb;
  --ui-aic-blue: var(--aui-blue, #4fb0fe);
  --ui-aic-amber: var(--aui-amber, #e8b000);
  --ui-aic-green: var(--aui-success, #1e8a4f);
  --ui-aic-red: var(--aui-red, #f04438);
  --ui-aic-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-aic-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  container-type: inline-size;
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-aic-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-aic *, .ui-aic *::before, .ui-aic *::after { box-sizing: border-box; }
:where(.ui-aic) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-aic button:focus-visible { outline: 2px solid var(--ui-aic-focus); outline-offset: 2px; }
.ui-aic ul, .ui-aic ol { margin: 0; padding: 0; list-style: none; }
.ui-aic svg { display: block; flex: none; }
.ui-aic__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- Bar: where you are, and the layout ----- */
.ui-aic__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 0 2px; }
.ui-aic__heading { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 14px; font-weight: 500; color: var(--ui-aic-ink); white-space: nowrap; }
.ui-aic__crumb { flex: none; color: var(--ui-aic-muted); font-weight: 400; }
.ui-aic__slash { flex: none; color: var(--aui-placeholder, var(--ui-aic-faint)); }
.ui-aic__heading-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-aic__views { display: flex; flex: none; gap: 2px; padding: 3px; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-aic-lane); }
.ui-aic__view { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: var(--aui-radius, 8px); font-size: 13px; font-weight: 500; color: var(--ui-aic-muted); transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease; }
.ui-aic__view:hover { color: var(--ui-aic-ink); }
.ui-aic__view[aria-checked="true"] { background: var(--ui-aic-card); color: var(--ui-aic-ink); box-shadow: 0 1px 2px color-mix(in srgb, var(--aui-purple, #a651f0) 8%, transparent), 0 0 0 1px color-mix(in srgb, var(--aui-purple, #a651f0) 4%, transparent); }

/* ----- Columns ----- */
.ui-aic__lanes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: start; }
.ui-aic__lane { min-width: 0; padding: 4px 4px 4px; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-aic-lane); }
.ui-aic__lane-head { display: grid; grid-template-columns: 20px 1fr minmax(20px, auto); align-items: center; height: 34px; padding: 0 8px 0 10px; }
.ui-aic__lane-spark { color: var(--ui-aic-blue); opacity: 0.7; }
.ui-aic__lane-name { overflow: hidden; font-size: 12px; font-weight: 500; text-align: center; color: var(--ui-aic-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-aic__count { display: grid; place-items: center; min-width: 20px; height: 18px; padding: 0 5px; border-radius: var(--aui-radius-sm, 6px); background: color-mix(in srgb, var(--aui-purple, #a651f0) 6%, transparent); font-size: 12px; font-weight: 500; color: var(--ui-aic-text); font-variant-numeric: tabular-nums; }
.ui-aic__cards { display: grid; gap: 6px; }
.ui-aic__empty { padding: 18px 0 20px; font-size: 13px; text-align: center; color: var(--aui-placeholder, var(--ui-aic-faint)); }

/* ----- A card ----- */
.ui-aic__card[data-faded] { opacity: 0.4; }
.ui-aic__card { position: relative; border-radius: var(--aui-radius-lg, 12px); background: var(--ui-aic-card); box-shadow: var(--aui-shadow-card, 0 0 0 1px var(--ui-aic-line), 0 1px 2px color-mix(in srgb, var(--aui-purple, #a651f0) 4%, transparent)); transition: box-shadow 200ms ease, opacity 240ms ease; }
.ui-aic__card:hover, .ui-aic__card[data-open] { box-shadow: 0 0 0 1px #dcdce1, 0 4px 14px -6px color-mix(in srgb, var(--aui-purple, #a651f0) 12%, transparent); }
.ui-aic__card-main { display: grid; gap: 6px; width: 100%; padding: 12px 14px 12px 12px; border-radius: var(--aui-radius-lg, 12px); container: aic-card / inline-size; }
/* Top-aligned: the spark stays on the first line when a long title wraps */
.ui-aic__title-row { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.ui-aic__spark { display: grid; flex: none; place-items: center; width: 16px; height: 20px; color: var(--ui-aic-blue); transition: color 300ms ease; }
.ui-aic__card[data-status="waiting"] .ui-aic__spark { color: var(--ui-aic-amber); }
.ui-aic__card[data-status="failed"] .ui-aic__spark { color: var(--ui-aic-red); }
.ui-aic__card[data-status="done"] .ui-aic__spark { color: var(--ui-aic-green); }
.ui-aic__title { min-width: 0; overflow: hidden; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--ui-aic-ink); text-align: start; white-space: nowrap; text-overflow: ellipsis; overflow-wrap: anywhere; }
.ui-aic__desc { display: -webkit-box; padding-left: 26px; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-aic-text); text-align: start; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* Open: the whole title and description, nothing cut off */
.ui-aic__card[data-open] .ui-aic__title { white-space: normal; }
.ui-aic__card[data-open] .ui-aic__desc { -webkit-line-clamp: unset; }
.ui-aic__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; margin-top: 4px; padding-left: 26px; }
.ui-aic__state { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--ui-aic-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
/* Never cut down to a single letter – a few letters and … at least; a space's width to the time, cut or not */
.ui-aic__state-word { min-width: 2.6em; overflow: hidden; text-overflow: ellipsis; white-space: pre; margin-right: calc(0.28em - 8px); }
.ui-aic__time { flex: none; }
.ui-aic__state-icon { display: grid; flex: none; place-items: center; width: 12px; height: 12px; color: var(--ui-aic-blue); animation: ui-aic-pop 360ms var(--ui-aic-ease) both; }
.ui-aic__state-icon[data-status="running"] svg { animation: ui-aic-spin 900ms linear infinite; }
.ui-aic__state-icon[data-status="waiting"] { color: var(--ui-aic-amber); }
.ui-aic__state-icon[data-status="done"] { color: var(--ui-aic-green); }
.ui-aic__state-icon[data-status="failed"] { color: var(--ui-aic-red); }
/* Waiting and Failed: a soft fill in the status color, the "!" in full */
.ui-aic__glyph-fill { fill: color-mix(in srgb, currentColor 24%, transparent); }
.ui-aic__glyph-mark { fill: none; stroke: currentColor; }
.ui-aic__meta { display: inline-flex; flex: none; align-items: center; font-size: 12px; color: var(--ui-aic-muted); font-variant-numeric: tabular-nums; }
.ui-aic__meta > span { display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; }
.ui-aic__meta > span + span { border-left: 1px solid var(--ui-aic-line); }
.ui-aic__meta > span:last-child { padding-right: 0; }

/* Open: steps and decisions unfold under the card's text */
.ui-aic__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 460ms var(--ui-aic-ease), opacity 240ms ease; }
.ui-aic__fold[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 460ms var(--ui-aic-ease), opacity 320ms ease 100ms; }
.ui-aic__clip { min-height: 0; overflow: hidden; }
/* Starts at the card's left edge, like the spark – the full width for reading */
.ui-aic__more { margin: 0 14px 0 12px; padding: 10px 0 12px; border-top: 1px solid var(--ui-aic-line); }
.ui-aic__agent { font-size: 12px; color: var(--ui-aic-muted); }
.ui-aic__steps { position: relative; display: grid; gap: 5px; margin-top: 6px !important; padding-left: 12px !important; }
.ui-aic__steps li { position: relative; display: flex; justify-content: space-between; gap: 10px; font-size: 13px; line-height: 18px; color: var(--ui-aic-text); }
.ui-aic__steps li::before { content: ""; position: absolute; top: 7px; left: -12px; width: 4px; height: 4px; border-radius: 50%; background: var(--ui-aic-faint); }
/* Short line segments between the dots, with a little air on both ends */
.ui-aic__steps li:not(:last-child)::after { content: ""; position: absolute; top: 15px; bottom: -8px; left: -10.5px; width: 1px; background: var(--ui-aic-line); }
.ui-aic__steps li[data-last]::before { background: var(--ui-aic-ink); }
.ui-aic__steps li > span { min-width: 0; text-align: start; overflow-wrap: anywhere; white-space: pre-line; }
/* A long time wraps on its side instead of squeezing the step to nothing */
.ui-aic__steps time { flex: none; max-width: 45%; color: var(--ui-aic-muted); text-align: end; }
.ui-aic__actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.ui-aic__actions:empty { display: none; }
.ui-aic__btn { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: var(--aui-radius, 8px); box-shadow: inset 0 0 0 1px var(--ui-aic-line); background: var(--ui-aic-card); font-size: 13px; font-weight: 500; color: var(--ui-aic-ink); transition: background-color 160ms ease; }
.ui-aic__btn:hover { background: var(--ui-aic-lane); }
.ui-aic__btn--primary { background: var(--aui-primary, var(--ui-aic-ink)); box-shadow: none; color: var(--aui-on-primary, var(--ui-aic-card)); }
.ui-aic__btn--primary:hover { background: #33333a; }

/* ----- List layout: the columns stack, one after another ----- */
.ui-aic[data-view="list"] .ui-aic__lanes { grid-template-columns: minmax(0, 1fr); }
.ui-aic[data-view="list"] .ui-aic__lane-head { grid-template-columns: 20px auto 1fr; gap: 4px; }
.ui-aic[data-view="list"] .ui-aic__lane-name { text-align: left; }
.ui-aic[data-view="list"] .ui-aic__count { justify-self: start; }
.ui-aic__lanes { animation: ui-aic-in 320ms ease both; }

@keyframes ui-aic-spin { to { transform: rotate(360deg); } }
@keyframes ui-aic-pop { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-aic-in { from { opacity: 0.4; } }

/* Narrow containers: always the list, without the switch */
@container (max-width: 620px) {
  .ui-aic__views { display: none; }
  .ui-aic .ui-aic__lanes { grid-template-columns: minmax(0, 1fr); }
  .ui-aic .ui-aic__lane-head { grid-template-columns: 20px auto 1fr; gap: 4px; }
  .ui-aic .ui-aic__lane-name { text-align: left; }
  .ui-aic .ui-aic__count { justify-self: start; }
}
/* Slim cards (three columns in a narrow board): the text starts under the spark, so the footer keeps its words */
@container aic-card (max-width: 300px) {
  .ui-aic__desc, .ui-aic__foot { padding-left: 0; }
  .ui-aic__state:is([data-status="running"], [data-status="done"]):not([data-bare]) .ui-aic__state-word { display: none; }
  /* Too little room beside big counts: the counts move to a line of their own instead of squeezing "Waiting for you" */
  .ui-aic__foot { flex-wrap: wrap; row-gap: 2px; }
  .ui-aic__state[data-status="waiting"] { flex: 1 1 110px; }
}
@container (max-width: 360px) {
  .ui-aic__desc, .ui-aic__foot { padding-left: 0; }
  .ui-aic__title { white-space: normal; }
  /* A long title wraps to three lines at most – the open card shows all of it */
  .ui-aic__card:not([data-open]) .ui-aic__title { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
}

@media (pointer: coarse) {
  .ui-aic__view { height: 32px; }
  .ui-aic__btn { height: 36px; padding: 0 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-aic *, .ui-aic *::before, .ui-aic *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-aic {
  --ui-aic-lane: var(--aui-subtle, #161618);
  --ui-aic-card: var(--aui-surface, #1e1e21);
  --ui-aic-line: var(--aui-border, #2c2c31);
  --ui-aic-ink: var(--aui-ink, #e3eef6);
  --ui-aic-text: var(--aui-muted, #b6b6bd);
  --ui-aic-muted: var(--aui-muted, #85858d);
  --ui-aic-faint: #5c5c63;
  --ui-aic-blue: var(--aui-blue, #4fb0fe);
  --ui-aic-amber: var(--aui-amber, #e6c24d);
  --ui-aic-green: var(--aui-green, #5fc88a);
  --ui-aic-red: var(--aui-red, #ff6b5f);
  --ui-aic-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
}
:where(.dark, [data-theme="dark"]) .ui-aic__card:hover, :where(.dark, [data-theme="dark"]) .ui-aic__card[data-open] { box-shadow: 0 0 0 1px #3a3a40, 0 6px 18px -8px rgba(32, 40, 46, 0.6); }
:where(.dark, [data-theme="dark"]) .ui-aic__count { background: rgba(255, 255, 255, 0.07); }
:where(.dark, [data-theme="dark"]) .ui-aic__btn--primary:hover { background: #d6d6da; }
`;
