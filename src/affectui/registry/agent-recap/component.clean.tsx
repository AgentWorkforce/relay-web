"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, CircleCheck, TriangleAlert, User } from "lucide-react";

/*
 * Agent Recap – what the agents did while you were away, in a single self-contained file.
 *   · the night as a small line chart: a peak wherever something happened, a dot on each peak, the area fading out
 *     below. When it opens the line draws itself from left to right, dots pop in as it passes and the counts count along
 *   · three lanes like a board – what needs you (with its action right on the card), what failed (with Retry) and
 *     what's done – all on one white panel
 *   · acting on a card swaps its last line in place – "Approved", with Undo – so nothing jumps; the counts follow
 *   · point at a card and its dot lights up on the chart, point at a dot and its card does
 * The styles are injected below, so no extra files are needed.
 */

export type RecapKind = "needs" | "failed" | "done";

export type RecapEvent = {
  id: string;
  /** When it happened – a Date, an ISO string or ms */
  at: Date | string | number;
  kind: RecapKind;
  title: string;
  /** One short line under it – who did it, why it needs you, what went wrong */
  detail?: string;
  /** A small mark – the company's or agent's logo */
  logo?: ReactNode;
  /** Done: how many of it, as a tag – e.g. 38 tickets. Also makes its peak taller */
  count?: number;
  /** Needs you: the main action – defaults to "Approve" */
  action?: string;
  /** Needs you: what the card says once it's done – defaults to "Done" */
  doneLabel?: string;
};

export type AgentRecapProps = {
  events: RecapEvent[];
  /** When you left – the chart starts here */
  since: Date | string | number;
  /** Now – the chart ends here; defaults to the time it renders */
  until?: Date | string | number;
  title?: string;
  /**
   * The main action on a card (Approve, Retry …) or "review" for the second button. Return a promise to show the card
   * working until it settles – a rejected one puts the card back
   */
  onAction?: (event: RecapEvent, action: "primary" | "review") => void | Promise<unknown>;
  /** Undo – on a card that was acted on, or on something an agent did (a done card) */
  onUndo?: (event: RecapEvent) => void;
  /** Redo on a done card that was undone */
  onRedo?: (event: RecapEvent) => void;
  /** Cards per lane at most – the lanes stay the same height */
  limit?: number;
  /** The lanes under the chart – false leaves a summary strip: the counts and the chart */
  board?: boolean;
  /** The done / need you / failed counts beside the title – false leaves the title alone */
  counts?: boolean;
  /** Length of the replay of the night, ms – 0 shows everything at once */
  replay?: number;
  locale?: string;
  /** The event under the pointer (or focused) changed – null when it leaves, e.g. to highlight it elsewhere */
  onHover?: (event: RecapEvent | null) => void;
  /** Picks the events that stay – the other dots fade, e.g. while a row about one agent is hovered elsewhere */
  focus?: ((event: RecapEvent) => boolean) | null;
  className?: string;
};

/** Open; being acted on; acted on (needs, failed); taken back (done) */
type State = "open" | "working" | "resolved" | "undone";

const ms = (v: Date | string | number) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime());
const span = (a: number, b: number) => {
  const m = Math.max(0, Math.round((b - a) / 60000));
  const h = Math.floor(m / 60);
  // Two days and more read as days
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return h ? `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`;
};

const EMPTY: Record<RecapKind, string> = { needs: "Nothing needs you", failed: "Nothing failed", done: "Nothing done yet" };
const LANES: { kind: RecapKind; label: string }[] = [
  { kind: "needs", label: "Needs you" },
  { kind: "failed", label: "Failed" },
  { kind: "done", label: "Done" },
];

/* The chart: a bump per event, summed – peaks where things happened */
const W = 1000;
const H = 100;
const TOP = 14;
const SAMPLES = 120;
const WIDTH = 0.022;
const weight = (e: RecapEvent) => (e.kind === "done" ? 0.7 + Math.log10((e.count ?? 1) + 1) * 0.45 : 1.05);

function curve(points: { t: number; w: number }[]) {
  const at = (x: number) => points.reduce((s, p) => s + p.w * Math.exp(-((x - p.t) ** 2) / (2 * WIDTH * WIDTH)), 0) + 0.04;
  const ys = Array.from({ length: SAMPLES + 1 }, (_, i) => at(i / SAMPLES));
  const max = Math.max(...ys, 0.2);
  const y = (v: number) => H - 2 - (v / max) * (H - TOP - 2);
  // Catmull-Rom through the samples, as cubic Béziers
  const pts = ys.map((v, i) => [(i / SAMPLES) * W, y(v)] as const);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C ${x1 + (x2 - p0[0]) / 6} ${y1 + (y2 - p0[1]) / 6}, ${x2 - (p3[0] - x1) / 6} ${y2 - (p3[1] - y1) / 6}, ${x2} ${y2}`;
  }
  return { line: d, area: `${d} L ${W} ${H} L 0 ${H} Z`, yAt: (t: number) => y(at(t)) / H };
}

export function AgentRecap({
  events,
  since,
  until,
  title = "While you were away",
  onAction,
  onUndo,
  onRedo,
  limit = 3,
  board = true,
  counts = true,
  replay = 1800,
  locale,
  onHover,
  focus,
  className,
}: AgentRecapProps) {
  const id = "ui-rcp" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const start = ms(since);
  // A given `until` is followed as it moves (a live clock slides the chart's right edge); without one, the moment it opened
  const [opened] = useState(() => Date.now());
  const end = until !== undefined ? ms(until) : opened;
  const total = Math.max(1, end - start);
  // Longer than a day, a time alone is ambiguous – the date goes in front
  const long = total > 24 * 3_600_000;
  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, long ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" }),
    [locale, long],
  );

  // Every event with where it sits on the chart (0–1), in time order
  const list = useMemo(
    () =>
      events
        // An event without a readable time can't sit on the chart – it's left out rather than breaking the line
        .filter((e) => Number.isFinite(ms(e.at)))
        .map((e) => ({ e, t: Math.min(1, Math.max(0, (ms(e.at) - start) / total)) }))
        .sort((a, b) => a.t - b.t),
    [events, start, total],
  );
  const chart = useMemo(() => curve(list.map(({ e, t }) => ({ t, w: weight(e) }))), [list]);

  // The replay: a playhead from 0 to 1, eased out
  const [head, setHead] = useState(replay > 0 ? 0 : 1);
  useEffect(() => {
    if (replay <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setHead(1);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / replay);
      setHead(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Frames don't run in a background tab – by the time the replay is over, show everything anyway
    const done = window.setTimeout(() => setHead(1), replay + 150);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [replay]);

  const [state, setState] = useState<Record<string, State>>({});
  const [hot, setHot] = useState<string | null>(null);
  const hover = useRef(onHover);
  hover.current = onHover;
  useEffect(() => {
    hover.current?.(hot ? (events.find((e) => e.id === hot) ?? null) : null);
  }, [hot]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cursor, setCursor] = useState<number | null>(null);
  const stateOf = (key: string): State => state[key] ?? "open";
  const set = (key: string, s: State) => setState((x) => ({ ...x, [key]: s }));

  // Keyboard: the button that was pressed goes away (Approve → Undo), so focus moves to the one that takes its place,
  // and a polite live region says what happened
  const root = useRef<HTMLElement>(null);
  // Moved by a key or the pointer – a click keeps focus where the browser puts it, so no ring appears on its own
  const byKey = useRef(false);
  const focusNext = useRef<{ id: string; to: "main" | "undo" | "redo" } | null>(null);
  const [said, setSaid] = useState("");
  const after = (e: RecapEvent, s: State, to: "main" | "undo" | "redo", message: string) => {
    focusNext.current = byKey.current ? { id: e.id, to } : null;
    set(e.id, s);
    setSaid(message);
  };
  useEffect(() => {
    const next = focusNext.current;
    const el = root.current;
    if (!next || !el) return;
    const target = el.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next.id)}"] [data-focus="${next.to}"]`);
    if (!target) return;
    focusNext.current = null;
    // Only when focus was in here (or got lost with the removed button) – never steal it from elsewhere
    const active = document.activeElement;
    if (!active || active === document.body || el.contains(active)) target.focus();
  });
  const actionOf = (e: RecapEvent) => (e.kind === "failed" ? "Retry" : (e.action ?? "Approve"));
  const doneText = (e: RecapEvent) => (e.kind === "failed" ? "Fixed" : (e.doneLabel ?? "Done"));

  const act = (e: RecapEvent, action: "primary" | "review") => {
    if (action === "review") return void onAction?.(e, "review");
    const out = onAction?.(e, "primary");
    if (out && typeof (out as Promise<unknown>).then === "function") {
      focusNext.current = null;
      set(e.id, "working");
      setSaid(`${e.kind === "failed" ? "Retrying" : "Working on"}: ${e.title}`);
      (out as Promise<unknown>).then(
        () => after(e, "resolved", "undo", `${doneText(e)}: ${e.title}`),
        () => after(e, "open", "main", `Didn't work: ${e.title}`),
      );
    } else after(e, "resolved", "undo", `${doneText(e)}: ${e.title}`);
  };
  const undo = (e: RecapEvent) => {
    after(e, e.kind === "done" ? "undone" : "open", e.kind === "done" ? "redo" : "main", `Undone: ${e.title}`);
    onUndo?.(e);
  };
  const redo = (e: RecapEvent) => {
    after(e, "open", "undo", `Redone: ${e.title}`);
    onRedo?.(e);
  };

  // Counts – only of what the playhead has passed, so they count along with the replay
  const seen = (t: number) => t <= head + 0.0001;
  const passed = list.filter((x) => seen(x.t));
  const open = (k: RecapKind) => passed.filter((x) => x.e.kind === k && stateOf(x.e.id) !== "resolved").length;
  const count = {
    done: passed.filter((x) => (x.e.kind === "done" && stateOf(x.e.id) !== "undone") || stateOf(x.e.id) === "resolved").length,
    needs: open("needs"),
    failed: open("failed"),
  };

  const hotItem = hot ? list.find((x) => x.e.id === hot) : undefined;
  // Where every full hour falls on the chart
  const hours = useMemo(() => {
    const out: number[] = [];
    const d = new Date(start);
    d.setMinutes(0, 0, 0);
    for (d.setHours(d.getHours() + 1); d.getTime() < end; d.setHours(d.getHours() + 1)) out.push((d.getTime() - start) / total);
    return out;
  }, [start, end, total]);

  return (
    <section ref={root} onKeyDownCapture={() => (byKey.current = true)} onPointerDownCapture={() => (byKey.current = false)} className={["ui-rcp", className].filter(Boolean).join(" ")} style={{ "--ui-rcp-limit": limit } as CSSProperties} aria-label={title}>
      {/* React 19 hoists this into <head> once, no matter how many instances render */}
      <style href="ui-agent-recap-clean" precedence="default">
        {css}
      </style>
      <p className="ui-rcp__sr" aria-live="polite">
        {said}
      </p>

      <header className="ui-rcp__head">
        <div>
          <h2 className="ui-rcp__title">{title}</h2>
          <p className="ui-rcp__since">
            Since {time.format(start)}
            <span className="ui-rcp__pill">{span(start, end)}</span>
          </p>
        </div>
        {counts && (
          <ul className="ui-rcp__counts" aria-label="Summary">
            {(["done", "needs", "failed"] as const).map((k) => (
              <li key={k} data-kind={k}>
                <KindIcon kind={k} />
                <b>{count[k]}</b> {k === "needs" ? "need you" : k}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* The night as a line chart: a peak per event, drawn from left to right as it replays */}
      <div
        className="ui-rcp__chart"
        aria-hidden="true"
        onPointerMove={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
          // Snap to an event close by – its dot lights up and says what it was
          const near = list.reduce<{ id: string; t: number } | null>((best, { e, t }) => (Math.abs(t - x) < 0.025 && (!best || Math.abs(t - x) < Math.abs(best.t - x)) ? { id: e.id, t } : best), null);
          setCursor(near ? near.t : x);
          setHot(near ? near.id : null);
        }}
        onPointerLeave={() => {
          setCursor(null);
          setHot(null);
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--ui-rcp-area)" stopOpacity="1" />
              <stop offset="1" stopColor="var(--ui-rcp-area)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${id}-clip`}>
              <rect x="0" y="0" width={head * W} height={H} />
            </clipPath>
          </defs>
          {/* A quiet grid: three level lines and one line per hour */}
          <g className="ui-rcp__grid">
            {[0.25, 0.5, 0.75].map((y) => (
              <line key={y} data-level={y} x1="0" x2={W} y1={y * H} y2={y * H} vectorEffect="non-scaling-stroke" />
            ))}
            {hours.map((x) => (
              <line key={x} data-hour="" x1={x * W} x2={x * W} y1="0" y2={H} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <g clipPath={`url(#${id}-clip)`}>
            <path className="ui-rcp__area" d={chart.area} fill={`url(#${id}-fade)`} />
            <path className="ui-rcp__line" d={chart.line} vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        <span className="ui-rcp__frame" />
        {/* Where the pointer is: a line through the whole chart */}
        {cursor !== null && <span className="ui-rcp__cursor" style={{ left: `${cursor * 100}%` }} />}
        {list.map(({ e, t }, i) => (
          <span
            key={`${e.id}:${i}`}
            className="ui-rcp__dot"
            data-kind={stateOf(e.id) === "resolved" ? "done" : e.kind}
            data-on={seen(t) || undefined}
            data-hot={hot === e.id || undefined}
            data-dim={(focus && !focus(e)) || undefined}
            style={{ left: `${t * 100}%`, top: `${chart.yAt(t) * 100}%` }}
            onPointerEnter={() => setHot(e.id)}
            onPointerLeave={() => setHot(null)}
          />
        ))}
        {hotItem && (
          <span
            className="ui-rcp__tip"
            style={{ left: `${hotItem.t * 100}%`, top: `${chart.yAt(hotItem.t) * 100}%` } as CSSProperties}
            data-edge={hotItem.t < 0.15 ? "start" : hotItem.t > 0.85 ? "end" : undefined}
          >
            {time.format(ms(hotItem.e.at))} · {hotItem.e.title}
          </span>
        )}
      </div>
      <div className="ui-rcp__ends" aria-hidden="true">
        <span>{time.format(start)}</span>
        <span>{time.format(end)}</span>
      </div>

      {/* The board */}
      {board && (
      <div className="ui-rcp__board">
        {LANES.map(({ kind, label }) => {
          const all = list.filter((x) => x.e.kind === kind);
          const rows = all.slice(0, limit);
          // The count is of everything in the lane, also what's beyond the limit
          const left = all.filter((x) => !["resolved", "undone"].includes(stateOf(x.e.id))).length;
          return (
            <div key={kind} className="ui-rcp__lane" data-kind={kind}>
              <h3 className="ui-rcp__lane-head">
                <span>
                  <KindIcon kind={kind} />
                  {label}
                </span>
                <span className="ui-rcp__lane-n" title={all.length > rows.length ? `Showing ${rows.length} of ${all.length}` : undefined}>
                  {left}
                </span>
              </h3>
              <ul className="ui-rcp__cards">
                {rows.length === 0 && <li className="ui-rcp__empty">{EMPTY[kind]}</li>}
                {rows.map(({ e, t }, i) => {
                  const s = stateOf(e.id);
                  return (
                    <li
                      key={`${e.id}:${i}`}
                      className="ui-rcp__card"
                      data-card-id={e.id}
                      onFocus={() => setHot(e.id)}
                      onBlur={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node | null) && setHot(null)}
                      data-kind={kind}
                      data-state={s}
                      data-seen={seen(t) || undefined}
                      data-hot={hot === e.id || undefined}
                      onPointerEnter={() => setHot(e.id)}
                      onPointerLeave={() => setHot(null)}
                    >
                      <span className="ui-rcp__card-top">
                        <span className="ui-rcp__mark" aria-hidden="true">
                          {s === "resolved" ? <TickIcon /> : (e.logo ?? Array.from(e.title.trim())[0]?.toUpperCase())}
                        </span>
                        <span className="ui-rcp__card-title" title={e.title}>
                          {e.title}
                        </span>
                      </span>
                      <span className="ui-rcp__card-meta">
                        <span className="ui-rcp__detail" title={e.detail}>
                          {e.detail}
                        </span>
                        {kind === "done" && e.count !== undefined && (
                          <span className="ui-rcp__tag" title={e.count >= 10000 ? e.count.toLocaleString(locale) : undefined}>
                            {new Intl.NumberFormat(locale, e.count >= 10000 ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(e.count)}
                          </span>
                        )}
                        <time className="ui-rcp__time" dateTime={new Date(ms(e.at)).toISOString()}>
                          {time.format(ms(e.at))}
                        </time>
                      </span>
                      {/* Every card ends in the same line, so they're all the same height */}
                      {kind === "done" ? (
                        <span className="ui-rcp__card-foot">
                          <span className="ui-rcp__status">
                            <span className="ui-rcp__state" data-off={s === "undone" || undefined}>
                              {s === "undone" ? "Undone" : "Done"}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="ui-rcp__btn"
                            data-focus={s === "undone" ? "redo" : "undo"}
                            aria-label={`${s === "undone" ? "Redo" : "Undo"}: ${e.title}`}
                            onClick={() => (s === "undone" ? redo(e) : undo(e))}
                          >
                            {s === "undone" ? "Redo" : "Undo"}
                          </button>
                        </span>
                      ) : (
                        <span className="ui-rcp__card-foot">
                          {s === "resolved" ? (
                            <>
                              <span className="ui-rcp__status">
                                <span className="ui-rcp__state">{doneText(e)}</span>
                              </span>
                              <button type="button" className="ui-rcp__btn" data-focus="undo" aria-label={`Undo: ${e.title}`} onClick={() => undo(e)}>
                                Undo
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="ui-rcp__status" data-working={s === "working" || undefined}>
                                {s === "working" ? (kind === "failed" ? "Retrying…" : "Working…") : ""}
                              </span>
                              {kind === "needs" && (
                                <button type="button" className="ui-rcp__btn" disabled={s === "working"} aria-label={`Review: ${e.title}`} onClick={() => act(e, "review")}>
                                  Review
                                </button>
                              )}
                              <button
                                type="button"
                                className="ui-rcp__btn ui-rcp__btn--main"
                                data-focus="main"
                                disabled={s === "working"}
                                aria-label={`${actionOf(e)}: ${e.title}`}
                                onClick={() => act(e, "primary")}
                              >
                                {s === "working" && <span className="ui-rcp__spin" aria-hidden="true" />}
                                <span className="ui-rcp__btn-label">{actionOf(e)}</span>
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

/** Needs you: a person – failed: a warning triangle – done: a check in a circle (Lucide, the dashboard's icon family) */
function KindIcon({ kind }: { kind: RecapKind }) {
  const Glyph = kind === "needs" ? User : kind === "failed" ? TriangleAlert : CircleCheck;
  return <Glyph className="ui-rcp__kind" data-kind={kind} aria-hidden="true" />;
}

function TickIcon() {
  return <Check aria-hidden="true" />;
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-rcp */
.ui-rcp {
  --ui-rcp-card: #ffffff;
  --ui-rcp-strong: #000000;
  --ui-rcp-ink: rgba(32, 40, 46, 0.88);
  --ui-rcp-text: rgba(32, 40, 46, 0.61);
  --ui-rcp-muted: rgba(32, 40, 46, 0.45);
  --ui-rcp-faint: rgba(32, 40, 46, 0.27);
  --ui-rcp-line: rgba(29, 79, 122, 0.06);
  --ui-rcp-lane: #f4f4f5;
  --ui-rcp-stroke: rgba(32, 40, 46, 0.42);
  --ui-rcp-area: rgba(29, 79, 122, 0.07);
  --ui-rcp-done: #a1a1aa;
  --ui-rcp-needs: #0070d6;
  --ui-rcp-failed: #f04438;
  --ui-rcp-ok: #1e8a4f;
  --ui-rcp-grid: rgba(29, 79, 122, 0.045);
  --ui-rcp-hover: #f7fafc;
  --ui-rcp-card-h: 90px;
  --ui-rcp-focus: rgba(0, 96, 226, 0.7);
  --ui-rcp-cursor: rgba(32, 40, 46, 0.22);
  --ui-rcp-dot: rgba(32, 40, 46, 0.55);
  --ui-rcp-ok-bg: rgba(95, 200, 138, 0.1);
  --ui-rcp-tip: #18181b;
  --ui-rcp-tip-text: #f7fafc;
  --ui-rcp-shadow: 0 0 0 0.5px rgba(29, 79, 122, 0.06), 0 1px 1px -1px rgba(29, 79, 122, 0.1), 0 1px 2px 0 rgba(29, 79, 122, 0.05);
  --ui-rcp-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 16px 16px 12px;
  border-radius: 12px;
  background: var(--ui-rcp-card);
  box-shadow: var(--ui-rcp-shadow);
  container: ui-rcp / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-rcp-text);
  -webkit-font-smoothing: antialiased;
  /* The dots on the chart: what needs you in orange, what failed in red – the same small dots as the rest, just in color */
  --ui-rcp-dot-needs: #f28a2e;
  --ui-rcp-dot-failed: var(--ui-rcp-failed);
}
.ui-rcp *, .ui-rcp *::before, .ui-rcp *::after { box-sizing: border-box; }
/* Resets without weight, so the component's own spacing always wins */
:where(.ui-rcp) :where(h2, h3, p, ul) { margin: 0; padding: 0; list-style: none; }
:where(.ui-rcp) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
.ui-rcp button:focus-visible { outline: 2px solid var(--ui-rcp-focus); outline-offset: 2px; }
.ui-rcp [data-kind="done"] { --k: var(--ui-rcp-done); }
.ui-rcp [data-kind="needs"] { --k: var(--ui-rcp-needs); }
.ui-rcp [data-kind="failed"] { --k: var(--ui-rcp-failed); }

/* ----- Head ----- */
.ui-rcp__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; }
.ui-rcp__title { font-size: 14px; font-weight: 500; line-height: 24px; color: var(--ui-rcp-strong); }
.ui-rcp__since { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--ui-rcp-muted); font-variant-numeric: tabular-nums; }
.ui-rcp__pill { padding: 0 6px; border-radius: 6px; background: rgba(29, 79, 122, 0.05); font-size: 12px; font-weight: 500; line-height: 18px; color: var(--ui-rcp-text); }
.ui-rcp__counts { display: flex; flex-wrap: wrap; gap: 4px 12px; min-width: 0; padding-top: 4px; font-size: 12px; line-height: 16px; color: var(--ui-rcp-muted); white-space: nowrap; }
.ui-rcp__counts li { display: inline-flex; align-items: center; gap: 5px; }
.ui-rcp__counts b { font-weight: 500; color: var(--ui-rcp-ink); font-variant-numeric: tabular-nums; }
.ui-rcp__kind { flex: none; width: 14px; height: 14px; color: var(--ui-rcp-muted); }

/* ----- The chart ----- */
.ui-rcp__chart { position: relative; height: 96px; margin: 14px 0 0; cursor: crosshair; }
.ui-rcp__grid line { stroke: var(--ui-rcp-grid); stroke-width: 1; }
.ui-rcp__chart svg { display: block; width: 100%; height: 100%; overflow: hidden; }
/* A line above and below the grid, in the grid's color – drawn over the area so its edge stays crisp */
.ui-rcp__cursor { position: absolute; top: 0; bottom: 0; width: 1px; margin-left: -0.5px; background: var(--ui-rcp-cursor); pointer-events: none; }
.ui-rcp__frame { position: absolute; inset: 0; border-top: 1px solid var(--ui-rcp-grid); border-bottom: 1px solid var(--ui-rcp-grid); pointer-events: none; }
.ui-rcp__line { fill: none; stroke: var(--ui-rcp-stroke); stroke-width: 1.5; stroke-linejoin: round; }
.ui-rcp__dot { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: var(--ui-rcp-dot); box-shadow: 0 0 0 1.5px var(--ui-rcp-card); transform: translate(-50%, -50%) scale(0); transition: transform 360ms var(--ui-rcp-ease), background-color 240ms ease, opacity 140ms ease; }
.ui-rcp__dot[data-dim] { opacity: 0.2; }
.ui-rcp__dot[data-on] { transform: translate(-50%, -50%) scale(1); }
/* A dot that arrives later – a live clock, new events – pops in too */
@starting-style { .ui-rcp__dot[data-on] { transform: translate(-50%, -50%) scale(0); } }
.ui-rcp__dot[data-hot] { transform: translate(-50%, -50%) scale(1.6); }
/* A wider, invisible target so the small dots are easy to point at */
.ui-rcp__dot::after { content: ""; position: absolute; inset: -6px; border-radius: 50%; }
.ui-rcp__dot[data-kind="needs"] { background: var(--ui-rcp-dot-needs); }
.ui-rcp__dot[data-kind="failed"] { background: var(--ui-rcp-dot-failed); }
.ui-rcp__tip { position: absolute; z-index: 2; max-width: 280px; overflow: hidden; margin-top: -12px; padding: 3px 8px; border-radius: 6px; background: var(--ui-rcp-tip); font-size: 12px; line-height: 16px; color: var(--ui-rcp-tip-text); white-space: nowrap; text-overflow: ellipsis; transform: translate(-50%, -100%); pointer-events: none; animation: ui-rcp-pop 140ms ease both; }
.ui-rcp__tip[data-edge="start"] { transform: translate(-12px, -100%); }
.ui-rcp__tip[data-edge="end"] { transform: translate(calc(-100% + 12px), -100%); }
.ui-rcp__ends { display: flex; justify-content: space-between; margin: 4px 0 0; font-size: 12px; line-height: 16px; color: var(--ui-rcp-faint); font-variant-numeric: tabular-nums; }

/* ----- The board ----- */
.ui-rcp__board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: stretch; margin-top: 14px; }
.ui-rcp__lane { padding: 4px; border-radius: 12px; background: var(--ui-rcp-lane); }
/* The icon sits right above the logos of the cards (lane 4px + card 9px), the count above their right edge */
.ui-rcp__lane-head { display: flex; align-items: center; justify-content: space-between; height: 32px; padding: 0 10px 0 9px; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-rcp-muted); }
.ui-rcp__lane-head > span:first-child { display: inline-flex; align-items: center; gap: 8px; }
.ui-rcp__lane-head .ui-rcp__kind { width: 18px; height: 14px; }
.ui-rcp__lane-n { display: grid; place-items: center; min-width: 20px; height: 18px; padding: 0 5px; border-radius: 6px; background: rgba(166, 81, 240, 0.06); font-size: 12px; color: var(--ui-rcp-text); font-variant-numeric: tabular-nums; }
/* Every lane keeps room for limit cards, however many it has */
.ui-rcp__cards { display: grid; grid-auto-rows: var(--ui-rcp-card-h); align-content: start; gap: 4px; min-height: calc(var(--ui-rcp-limit) * var(--ui-rcp-card-h) + (var(--ui-rcp-limit) - 1) * 4px); }

/* A card keeps its height in every state – acting on it swaps its last line in place */
.ui-rcp__card { display: grid; align-content: start; gap: 2px; min-width: 0; padding: 9px 10px 9px 9px; border-radius: 12px; background: var(--ui-rcp-card); box-shadow: var(--ui-rcp-shadow); opacity: 0; filter: blur(2px); transform: translateY(4px); transition: opacity 320ms ease, filter 320ms ease, transform 420ms var(--ui-rcp-ease), box-shadow 160ms ease, background-color 160ms ease; }
.ui-rcp__card[data-seen] { opacity: 1; filter: none; transform: none; }
.ui-rcp__card[data-hot] { background: var(--ui-rcp-hover); box-shadow: 0 0 0 0.5px rgba(29, 79, 122, 0.1), 0 1px 3px rgba(29, 79, 122, 0.06); }
.ui-rcp__card-top { display: flex; align-items: center; gap: 8px; min-width: 0; height: 20px; }
.ui-rcp__mark { display: grid; flex: none; place-items: center; width: 18px; height: 18px; overflow: hidden; border-radius: 6px; background: var(--ui-rcp-card); box-shadow: var(--ui-rcp-shadow); font-size: 12px; font-weight: 500; color: var(--ui-rcp-ink); transition: background-color 200ms ease, color 200ms ease; }
.ui-rcp__mark > svg { width: 11px; height: 11px; }
.ui-rcp__card[data-state="resolved"] .ui-rcp__mark { background: var(--ui-rcp-ok-bg); box-shadow: none; color: var(--ui-rcp-ok); }
.ui-rcp__card-title { flex: 1; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-rcp-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-rcp__card:is([data-state="resolved"], [data-state="undone"]) .ui-rcp__card-title { color: var(--ui-rcp-muted); }
.ui-rcp__time { flex: none; font-size: 12px; color: var(--ui-rcp-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-rcp__card-meta { display: flex; align-items: center; gap: 8px; min-width: 0; height: 18px; padding-left: 26px; }
.ui-rcp__detail { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-rcp-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-rcp__card[data-kind="failed"][data-state="open"] .ui-rcp__detail { color: var(--ui-rcp-failed); }
.ui-rcp__tag { flex: none; padding: 0 5px; border-radius: 6px; background: rgba(29, 79, 122, 0.05); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-rcp-text); font-variant-numeric: tabular-nums; }
.ui-rcp__card-foot { display: flex; align-items: center; justify-content: flex-end; gap: 4px; height: 24px; margin-top: 6px; }
.ui-rcp__status { display: flex; flex: 1; min-width: 0; overflow: hidden; font-size: 12px; color: var(--ui-rcp-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Done, Fixed, Approved … as a small green tag – Undone as a gray one */
.ui-rcp__state { padding: 0 6px; border-radius: 6px; background: var(--ui-rcp-ok-bg); font-size: 12px; font-weight: 500; line-height: 20px; color: var(--ui-rcp-ok); }
.ui-rcp__state[data-off] { background: rgba(29, 79, 122, 0.05); color: var(--ui-rcp-muted); }
/* Quiet buttons: the main one white with a hairline, Review just text */
.ui-rcp__btn { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border-radius: 6px; font-size: 12px !important; font-weight: 500; color: var(--ui-rcp-muted) !important; white-space: nowrap; transition: background-color 160ms ease, color 160ms ease, transform 160ms ease, opacity 160ms ease; }
.ui-rcp__btn:hover:not(:disabled) { background: rgba(29, 79, 122, 0.04) !important; color: var(--ui-rcp-ink) !important; }
.ui-rcp__btn--main { padding: 0 9px; background: var(--ui-rcp-card) !important; box-shadow: var(--ui-rcp-shadow); color: var(--ui-rcp-ink) !important; }
.ui-rcp__btn--main:hover:not(:disabled) { background: var(--ui-rcp-card) !important; box-shadow: 0 0 0 0.5px rgba(29, 79, 122, 0.12), 0 1px 3px rgba(29, 79, 122, 0.08); }
.ui-rcp__btn:active:not(:disabled) { transform: scale(0.97); }
.ui-rcp__btn:disabled { opacity: 0.6; cursor: default !important; }
.ui-rcp__spin { width: 11px; height: 11px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: ui-rcp-spin 700ms linear infinite; }
/* For screen readers only */
.ui-rcp__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
/* A lane with nothing in it keeps its room and says so */
.ui-rcp__cards { position: relative; }
.ui-rcp__empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: var(--ui-rcp-faint); }
/* Long titles and labels end in … inside the card, never past it */
.ui-rcp__card { grid-template-columns: minmax(0, 1fr); }
.ui-rcp__btn { flex: none; }
.ui-rcp__btn--main { flex: 0 1 auto; min-width: 0; max-width: 70%; }
.ui-rcp__btn-label { overflow: hidden; text-overflow: ellipsis; }
.ui-rcp button:focus-visible { outline: 2px solid var(--ui-rcp-focus); outline-offset: 2px; }

@keyframes ui-rcp-pop { from { opacity: 0; } }
@keyframes ui-rcp-spin { to { transform: rotate(360deg); } }

/* Narrow: the three lanes stack */
@container ui-rcp (max-width: 640px) {
  .ui-rcp__board { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-rcp *, .ui-rcp *::before, .ui-rcp *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: switches when an ancestor (usually <html>) has the class dark or data-theme="dark" */
:where(.dark, [data-theme="dark"]) .ui-rcp {
  --ui-rcp-card: #1c1c1f;
  --ui-rcp-strong: #ffffff;
  --ui-rcp-ink: rgba(255, 255, 255, 0.9);
  --ui-rcp-text: rgba(255, 255, 255, 0.62);
  --ui-rcp-muted: rgba(255, 255, 255, 0.45);
  --ui-rcp-faint: rgba(255, 255, 255, 0.28);
  --ui-rcp-line: rgba(255, 255, 255, 0.08);
  --ui-rcp-lane: #161618;
  --ui-rcp-stroke: rgba(255, 255, 255, 0.5);
  --ui-rcp-area: rgba(255, 255, 255, 0.08);
  --ui-rcp-done: #71717a;
  --ui-rcp-needs: #4fb0fe;
  --ui-rcp-failed: #ff6b5f;
  --ui-rcp-ok: #2fb26a;
  --ui-rcp-grid: rgba(255, 255, 255, 0.05);
  --ui-rcp-hover: #222226;
  --ui-rcp-cursor: rgba(255, 255, 255, 0.28);
  --ui-rcp-focus: rgba(77, 141, 255, 0.8);
  --ui-rcp-dot: rgba(255, 255, 255, 0.65);
  --ui-rcp-ok-bg: rgba(125, 207, 159, 0.16);
  --ui-rcp-tip: #f7fafc;
  --ui-rcp-tip-text: #111113;
  --ui-rcp-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(32, 40, 46, 0.4);
  /* The dots on the chart: what needs you in orange, what failed in red – the same small dots as the rest, just in color */
  --ui-rcp-dot-needs: #f2a15c;
  --ui-rcp-dot-failed: var(--ui-rcp-failed);
}
:where(.dark, [data-theme="dark"]) .ui-rcp__lane-n { background: rgba(255, 255, 255, 0.08); }
:where(.dark, [data-theme="dark"]) .ui-rcp__tag, :where(.dark, [data-theme="dark"]) .ui-rcp__pill, :where(.dark, [data-theme="dark"]) .ui-rcp__state[data-off] { background: rgba(255, 255, 255, 0.08); }
:where(.dark, [data-theme="dark"]) .ui-rcp__btn:not(.ui-rcp__btn--main):hover:not(:disabled) { background: rgba(255, 255, 255, 0.06) !important; }
`;
