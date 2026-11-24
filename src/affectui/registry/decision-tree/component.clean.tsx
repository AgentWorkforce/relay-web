"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { BadgeCheck, Check, GitFork, TriangleAlert } from "lucide-react";

/*
 * Decision Tree – an agent that is stuck on a decision lays it out as a tree, in a single self-contained file.
 * One quiet white card with hairlines, a bar on top: how many decisions wait and where you are.
 *   · on the left the question, with the agent, its model and how risky the call is
 *   · from it the options as branches, each with what it leads to – the agent's own pick marked
 *   · risky consequences are marked – point at one (or press F) for the agent's note and its source
 *   · a branch can lead to a follow-up question with its own options – the whole tree shows at once, the follow-ups
 *     quiet until it's their turn; the agent's pick runs through both levels as one route
 *   · options carry the logo of the tool they run with, consequences the logos of the systems they touch
 *   · point at a branch and its path lights up while the others step back; pick one (click or 1–4) and the
 *     others fade – a follow-up wakes up and is picked the same way – the path draws on to its outcome, and the
 *     next decision grows in
 *   · "Other…" opens a field that grows with what you write – your own instruction, Enter sends it
 * Narrow containers draw the tree top to bottom. The styles are injected below, so no extra files are needed.
 */

export type DecisionRisk = "high" | "medium" | "low";

/** A part of a consequence the agent isn't sure about – marked, its note shows on hover */
export type DecisionFlag = { text: string; note: string; source?: string };
/** Plain text, or text with flagged parts in it */
export type DecisionText = string | (string | DecisionFlag)[];

export type DecisionOption = {
  /** What to do, in a few words – e.g. "Roll back to #481" */
  label: string;
  /** The tool it runs with – a small logo before the label, e.g. the Vercel mark */
  icon?: ReactNode;
  /** What it leads to, one line each – e.g. "Refunds $147 · not reversible" */
  effects?: DecisionText[];
  /** The systems it touches – small logos beside its consequences */
  apps?: ReactNode[];
  /** The agent's own preference – marked "Agent's pick" */
  pick?: boolean;
  /** A follow-up question this branch leads to – picked right after it. One level deep: its options end the path */
  next?: DecisionStep;
};

/** A follow-up question with two to four options */
export type DecisionStep = { question: string; options: DecisionOption[] };

export type Decision = {
  id: string;
  /** The question, in one sentence – e.g. "3 customers have two subscriptions – how should I proceed?" */
  question: string;
  /** A line of context under it */
  context?: string;
  /** Who asks, e.g. "Billing agent" */
  agent: string;
  /** The model behind the agent – shown under its name */
  model?: string;
  /** A small mark, e.g. the model maker's logo – defaults to the agent's initial */
  icon?: ReactNode;
  /** High and medium show as a small tag next to the agent */
  risk?: DecisionRisk;
  /** Two to four options */
  options: DecisionOption[];
  /* ----- Agent Relay additions (local copy) ----- */
  /** Recorded mode: the option that was taken – its path is drawn to the outcome */
  chosen?: number;
  /** Something under the question, e.g. a link to where it was asked */
  action?: ReactNode;
  /** Recorded mode: still waiting for an answer – a branch is picked for real (onChoose), not only inspected */
  open?: boolean;
};

/** What you chose: one of the options, or your own instruction */
export type DecisionChoice = { index: number; option: DecisionOption; then?: { index: number; option: DecisionOption } } | { other: string };

/** Drive it from outside – e.g. your own shortcuts, or a demo */
export type DecisionTreeHandle = {
  /** Lights up the n-th branch (or, after a pick, the n-th option of its follow-up) as if pointed at – null lets go */
  hover: (index: number | null) => void;
  /** Picks the n-th option – or, after a pick, the n-th option of its follow-up; the index after the last option opens "Other…" */
  choose: (index: number) => void;
  /** Fills the "Other…" field */
  setOther: (text: string) => void;
  /** Sends the "Other…" field */
  send: () => void;
  next: () => void;
  previous: () => void;
  /** Shows the note of the n-th flagged part – null hides it */
  peek: (index: number | null) => void;
};

export type DecisionTreeProps = {
  /** Everything waiting for a call – decided ones leave on their own, new ids join at the end */
  decisions: Decision[];
  /** A branch was picked or an instruction written – return the agent's short answer to an instruction (or a promise of it) */
  onChoose?: (decision: Decision, choice: DecisionChoice) => string | void | Promise<string | void>;
  /** Shows the "Other…" branch (default true) */
  allowOther?: boolean;
  title?: string;
  ref?: Ref<DecisionTreeHandle>;
  className?: string;
  /* ----- Agent Relay additions (local copy) ----- */
  /**
   * Recorded mode: decisions that were already made. Nothing is picked or leaves – a branch (click or 1–9) is
   * inspected instead, and the taken one is drawn to its outcome
   */
  recorded?: boolean;
  /** The branch being inspected (recorded mode) */
  inspected?: number | null;
  onInspect?: (decision: Decision, index: number | null) => void;
  /** Called when another decision is shown */
  onCurrentChange?: (decision: Decision | undefined, index: number) => void;
  /** Controls at the end of the title row */
  actions?: ReactNode;
  /** The count in the title row, e.g. "Request 2 of 5" – defaults to how many wait */
  countLabel?: (index: number, total: number) => string;
  /** The decision to show first (its id) */
  startAt?: string;
  /** What the picked branch led to, shown under it in recorded mode (default "Recorded choice") */
  outcome?: (decision: Decision, index: number) => ReactNode;
};

/* ---------- Helpers ---------- */

const RISK: Record<DecisionRisk, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
/** First letter or digit of the agent – an emoji or an empty name never ends up half in the mark */
const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase() || "AI";
const fmt = new Intl.NumberFormat("en-US");
/** Motion: how long the picked path shows its outcome, and how long the tree takes to fade */
const HOLD = 1500;
const ANSWER_HOLD = 2600;
const FADE = 280;
const partsOf = (t?: DecisionText): (string | DecisionFlag)[] => (t === undefined ? [] : typeof t === "string" ? [t] : t);
// Agent Relay: matchMedia may be missing (tests), then motion stays on
const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

type Link = { id: string; d: string; b: number; s?: number; kind: "branch" | "leaf" | "sub" | "out" };
/** `j` is the pick in the follow-up – a branch with a follow-up waits for it */
type Picked = { id: string; i: number; j?: number; other?: string; answer?: string; leaving?: boolean };
/** Every consequence in the order it shows – the flagged parts are numbered in this order */
const effectsOf = (d: Decision) => d.options.flatMap((o) => (o.next ? o.next.options.flatMap((s) => s.effects ?? []) : (o.effects ?? [])));

/* ---------- Icons ---------- */

/* Agent Relay: Lucide, the dashboard's one icon family */
const Tick = () => <Check size={16} aria-hidden="true" />;
const Alert = () => <TriangleAlert size={14} aria-hidden="true" />;
const Branches = () => <GitFork size={16} aria-hidden="true" />;
const Badge = ({ size = 16 }: { size?: number }) => <BadgeCheck size={size} aria-hidden="true" />;

export function DecisionTree({
  decisions,
  onChoose,
  allowOther: allowOtherProp = true,
  title = "Decisions",
  ref,
  className,
  recorded = false,
  inspected = null,
  onInspect,
  onCurrentChange,
  actions,
  countLabel,
  outcome,
  startAt,
}: DecisionTreeProps) {
  // A recorded decision takes no new instruction
  const allowOther = allowOtherProp && !recorded;
  const tipId = `${useId()}-tip`;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const growRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const flagEls = useRef(new Map<number, HTMLElement>());
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const tref = (k: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(k, el);
    else els.current.delete(k);
  };

  /* ---------- State ---------- */

  const [done, setDone] = useState<Record<string, true>>({});
  const [currentId, setCurrentId] = useState<string | null>(startAt ?? null);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const pickedState = picked;
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState("");
  const [peek, setPeek] = useState<number | null>(null);
  const [hoverFlag, setHoverFlag] = useState<number | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [narrow, setNarrow] = useState(false);

  // Each decision gets its own key – two with the same id stay apart, so next and done reach both
  const keys = new Map<Decision, string>();
  const seenIds = new Map<string, number>();
  for (const d of decisions) {
    const n = seenIds.get(d.id) ?? 0;
    seenIds.set(d.id, n + 1);
    keys.set(d, n ? `${d.id}#${n}` : d.id);
  }
  const keyOf = (d: Decision) => keys.get(d) ?? d.id;
  const list = decisions.filter((d) => !done[keyOf(d)]);
  const lastIndex = useRef(0);
  const found = list.findIndex((d) => keyOf(d) === currentId);
  const index = found >= 0 ? found : Math.min(lastIndex.current, list.length - 1);
  const current = index >= 0 ? list[index] : undefined;
  const total = decisions.length;
  const decided = Object.keys(done).length;
  useLayoutEffect(() => {
    lastIndex.current = Math.max(0, index);
    if (current && keyOf(current) !== currentId) setCurrentId(keyOf(current));
  });
  const shownKey = current ? keyOf(current) : null;
  useEffect(() => {
    onCurrentChange?.(current, index);
  }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // A fresh decision starts clean
  useLayoutEffect(() => {
    setHover(null);
    setPicked(null);
    setOtherOpen(false);
    setOther("");
    setPeek(null);
    setHoverFlag(null);
  }, [current && keyOf(current)]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Measured right away too, so the first frame already draws the right way round
    setNarrow(root.clientWidth < 640);
    const ro = new ResizeObserver(() => setNarrow(root.clientWidth < 640));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  /* ---------- Actions ---------- */

  const flash = (name: string) => {
    setPressed(name);
    later(() => setPressed((p) => (p === name ? null : p)), 220);
  };
  // The picked path holds a moment with its outcome, the tree fades, the next one grows in
  const finish = (d: Decision, hold: number) => {
    const fade = reduced() ? 0 : FADE;
    later(() => setPicked((p) => (p && p.id === keyOf(d) ? { ...p, leaving: true } : p)), hold);
    later(() => {
      setDone((x) => ({ ...x, [keyOf(d)]: true }));
      const keep = rootRef.current?.contains(document.activeElement);
      if (keep) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
    }, hold + fade);
  };
  // A branch with a follow-up is picked, its follow-up waits
  const waiting = current && picked?.id === keyOf(current) && picked.other === undefined && picked.j === undefined ? current.options[picked.i]?.next : undefined;
  const choose = (i: number) => {
    if (!current) return;
    const d = current;
    if (recorded && d.open && d.chosen === undefined) {
      // A question that still waits: this is the answer – the path draws through and the agent goes on
      const o = d.options[i];
      if (!o) return;
      flash(`opt:${i}`);
      setHover(null);
      setSaid(`${o.label} – picked. ${d.agent.trim() || "The agent"} goes ahead.`);
      void onChoose?.(d, { index: i, option: o });
      return;
    }
    if (recorded) {
      if (!d.options[i]) return;
      flash(`opt:${i}`);
      onInspect?.(d, inspected === i ? null : i);
      setSaid(`${d.options[i].label} – details below.`);
      return;
    }
    if (waiting && picked) {
      const s = waiting.options[i];
      if (!s) return;
      flash(`sopt:${picked.i}:${i}`);
      setHover(null);
      setPeek(null);
      setPicked({ ...picked, j: i });
      setSaid(`${s.label} – picked. ${d.agent.trim() || "The agent"} goes ahead.`);
      void onChoose?.(d, { index: picked.i, option: d.options[picked.i], then: { index: i, option: s } });
      finish(d, HOLD);
      return;
    }
    if (picked) return;
    if (allowOther && i === d.options.length) {
      flash("other");
      setOtherOpen(true);
      setHover(i);
      requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
      return;
    }
    const o = d.options[i];
    if (!o) return;
    flash(`opt:${i}`);
    setHover(null);
    setPeek(null);
    setPicked({ id: keyOf(d), i });
    if (o.next) {
      setSaid(`${o.label} – picked. Next: ${o.next.question}`);
      return;
    }
    setSaid(`${o.label} – picked. ${d.agent.trim() || "The agent"} goes ahead.`);
    void onChoose?.(d, { index: i, option: o });
    finish(d, HOLD);
  };
  const send = () => {
    const text = other.trim();
    if (!current || !text || picked) return;
    const d = current;
    flash("send");
    setPicked({ id: keyOf(d), i: d.options.length, other: text });
    setSaid(`Sent to the ${(d.agent.trim() || "Agent").toLowerCase()}: ${text}`);
    Promise.resolve(onChoose?.(d, { other: text })).then((answer) => {
      later(() => {
        const reply = answer || "Got it – I'll take it from here.";
        setPicked((p) => (p && p.id === keyOf(d) ? { ...p, answer: reply } : p));
        setSaid(`${d.agent.trim() || "Agent"}: ${reply}`);
      }, 700);
      finish(d, ANSWER_HOLD);
    });
  };
  const move = (step: number) => {
    if (list.length < 2 || !current || picked) return;
    setCurrentId(keyOf(list[(index + step + list.length) % list.length]));
  };
  const flags = current ? effectsOf(current).flatMap((e) => partsOf(e)).filter((p): p is DecisionFlag => typeof p !== "string") : [];
  const cycleFlag = () => flags.length && setPeek((p) => (p === null ? 0 : p + 1 >= flags.length ? null : p + 1));

  useImperativeHandle(ref, () => ({
    hover: (i: number | null) => (!picked || waiting) && setHover(i),
    choose,
    setOther: (text: string) => {
      if (!otherOpen) setOtherOpen(true);
      setOther(text);
    },
    send,
    next: () => move(1),
    previous: () => move(-1),
    peek: (i: number | null) => setPeek(i),
  }));

  /* ---------- Keyboard: numbers pick, arrows move, while the focus is anywhere inside ---------- */

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || !current) return;
    if ((e.target as HTMLElement).closest("textarea, input")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    const n = Number(e.key);
    const count = waiting ? waiting.options.length : current.options.length + (allowOther ? 1 : 0);
    if (n >= 1 && n <= count) return run(() => choose(n - 1));
    const keys: Record<string, () => void> = {
      arrowright: () => move(1),
      j: () => move(1),
      arrowleft: () => move(-1),
      k: () => move(-1),
      f: () => void cycleFlag(),
      escape: () => (peek !== null ? setPeek(null) : recorded ? onInspect?.(current, null) : setOtherOpen(false)),
    };
    const fn = keys[e.key.toLowerCase()];
    if (fn) run(fn);
  };

  /* ---------- The lines: question to branches, branches to consequences, the pick to its outcome ---------- */

  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const box = treeRef.current;
    if (!box || !current) return;
    const measure = () => {
      // Offsets up to the page, minus the box's own – they ignore transforms, so the lines land where the cards settle
      const page = (el: HTMLElement) => {
        let l = 0;
        let t = 0;
        for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
          l += e.offsetLeft;
          t += e.offsetTop;
        }
        return { l, t };
      };
      const origin = page(box);
      const R = (k: string) => {
        const el = els.current.get(k);
        // Folded away (narrow: a follow-up that isn't its turn yet) – no line to it
        if (!el || !el.offsetParent) return null;
        const p = page(el);
        const l = p.l - origin.l;
        const t = p.t - origin.t;
        return { l, t, r: l + el.offsetWidth, b: t + el.offsetHeight, h: el.offsetHeight };
      };
      const C = 8;
      // Wide: out of the right edge, a right-angled turn with small rounded corners, into the left edge
      const across = (x1: number, y1: number, x2: number, y2: number) => {
        const dy = y2 - y1;
        if (Math.abs(dy) < 2) return `M${x1} ${y1}H${x2}`;
        const mid = Math.round(x1 + (x2 - x1) / 2);
        const r = Math.min(C, Math.abs(dy) / 2, (x2 - x1) / 2);
        const sg = Math.sign(dy);
        return `M${x1} ${y1}H${mid - r}Q${mid} ${y1} ${mid} ${y1 + sg * r}V${y2 - sg * r}Q${mid} ${y2} ${mid + r} ${y2}H${x2}`;
      };
      // Narrow: down a rail on the left, a rounded corner, into the card's side
      const hang = (x1: number, y1: number, x2: number, y2: number) => {
        if (x2 - x1 < 2) return `M${x1} ${y1}V${y2}`;
        const r = Math.min(C, (y2 - y1) / 2, (x2 - x1) / 2);
        return `M${x1} ${y1}V${y2 - r}Q${x1} ${y2} ${x1 + r} ${y2}H${x2}`;
      };
      const root = R("root");
      if (!root) return;
      const next: Link[] = [];
      const n = current.options.length + (allowOther ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const o = R(`opt:${i}`);
        if (!o) continue;
        // "Other…" is met at its first line, so it can grow downwards without dragging its line along
        const isOther = i === current.options.length;
        const oc = isOther ? o.t + 18 : o.t + o.h / 2;
        next.push({ id: `b${i}`, b: i, kind: "branch", d: narrow ? hang(root.l + 18, root.b, o.l, o.t + Math.min(18, o.h / 2)) : across(root.r, root.t + root.h / 2, o.l, oc) });
        const lf = R(`leaf:${i}`) ?? R(`subq:${i}`);
        if (lf) next.push({ id: `l${i}`, b: i, kind: "leaf", d: narrow ? hang(o.l + 16, o.b, lf.l, lf.t + Math.min(14, lf.h / 2)) : across(o.r, o.t + o.h / 2, lf.l, lf.t + lf.h / 2) });
        // A follow-up: its options hang off a rail under its question
        const sq = R(`subq:${i}`);
        const subs = current.options[i]?.next?.options ?? [];
        if (sq)
          subs.forEach((_, j) => {
            const so = R(`sopt:${i}:${j}`);
            if (so) next.push({ id: `s${i}-${j}`, b: i, s: j, kind: "sub", d: hang(sq.l + 14, sq.b, so.l, so.t + Math.min(16, so.h / 2)) });
          });
      }
      // The outcome hangs under the picked branch's last card
      const outEl = els.current.get("out");
      // Recorded: the branch looked at, else the one taken – the same pick the tree draws
      const shown = recorded ? inspected ?? current.chosen : undefined;
      const picked = recorded ? (shown !== undefined && shown !== null ? ({ id: keyOf(current), i: shown } as Picked) : null) : pickedState;
      if (outEl && picked) {
        const from = (picked.j !== undefined ? R(`sopt:${picked.i}:${picked.j}`) : null) ?? R(`leaf:${picked.i}`) ?? R(`opt:${picked.i}`);
        // Recorded: beside the outcome, as the other branches stay in place under it
        if (from && (picked.other !== undefined || recorded) && !narrow) {
          // Your own instruction sits in the last row – its answer goes beside it, where the column is free
          outEl.style.left = `${from.r + 24}px`;
          // Never wider than the room to its right – narrow cards keep it inside
          outEl.style.maxWidth = `${Math.max(120, Math.min(280, box.clientWidth - (from.r + 24)))}px`;
          outEl.style.top = `${from.t}px`;
          const oc = R("out")!;
          next.push({ id: "o", b: picked.i, kind: "out", d: across(from.r, from.t + 18, oc.l, oc.t + 18) });
        } else if (from) {
          outEl.style.left = `${from.l + 24}px`;
          // Never wider than the room to its right – narrow cards keep it inside
          outEl.style.maxWidth = `${Math.max(120, Math.min(280, box.clientWidth - (from.l + 24)))}px`;
          outEl.style.top = `${from.b + 14}px`;
          const oc = R("out")!;
          next.push({ id: "o", b: picked.i, kind: "out", d: hang(from.l + 12, from.b, oc.l, oc.t + Math.min(16, oc.h / 2)) });
        }
      }
      const key = JSON.stringify(next);
      setLinks((prev) => (JSON.stringify(prev) === key ? prev : next));
      setSize((sz) => (sz.w === box.scrollWidth && sz.h === box.scrollHeight ? sz : { w: box.scrollWidth, h: box.scrollHeight }));
    };
    measure();
    // Every frame of a card's growth reports a new size – the lines follow it
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const el of els.current.values()) ro.observe(el);
    return () => ro.disconnect();
  });

  /* ---------- "Other…": two lines when it opens, it grows to three, then it scrolls ---------- */

  useLayoutEffect(() => {
    const box = growRef.current;
    const m = mirrorRef.current;
    const ta = otherRef.current;
    if (!box || !m || !ta) return;
    const line = 20;
    const pad = 12;
    const h = Math.min(Math.max(m.offsetHeight, 2 * line + pad), 3 * line + pad);
    // It starts at one line, so opening is the first glide down to two
    if (!box.style.height) box.style.height = `${line + pad}px`;
    requestAnimationFrame(() => {
      box.style.height = `${h}px`;
    });
    const over = m.offsetHeight > 3 * line + pad;
    ta.style.overflowY = over ? "auto" : "hidden";
    if (over) ta.scrollTop = ta.scrollHeight;
  });

  /* ---------- The agent's note on a flagged part ---------- */

  const tipIndex = hoverFlag ?? peek;
  // Notes show until the path is complete – also while a follow-up waits for its pick
  const open = !picked || !!waiting;
  const tipFlag = tipIndex !== null && open ? flags[tipIndex] : undefined;
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const body = bodyRef.current;
    const el = tipIndex !== null ? flagEls.current.get(tipIndex) : undefined;
    if (!tip || !body || !el) return;
    const b = body.getBoundingClientRect();
    const scale = body.offsetWidth ? b.width / body.offsetWidth : 1;
    const lines = el.getClientRects();
    const r = lines[0] ?? el.getBoundingClientRect();
    const rEnd = lines[lines.length - 1] ?? r;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const top = (r.top - b.top) / scale;
    const bottom = (rEnd.bottom - b.top) / scale;
    const center = (r.left + r.width / 2 - b.left) / scale;
    // Below the part by default – above only when there's no room under it
    const above = bottom + 8 + h > body.offsetHeight - 4 && top - h - 8 >= 4;
    const left = Math.max(10, Math.min(center - w / 2, body.offsetWidth - w - 10));
    tip.style.top = `${above ? top - h - 8 : bottom + 8}px`;
    tip.style.left = `${left}px`;
    tip.style.setProperty("--x", `${center - left}px`);
    tip.dataset.side = above ? "above" : "below";
  });

  /* ---------- Pieces ---------- */

  const text = (t: DecisionText, counter: { n: number }) =>
    partsOf(t).map((p, k) => {
      if (typeof p === "string") return <span key={k}>{p}</span>;
      const i = counter.n++;
      const on = tipIndex === i && open;
      return (
        <mark
          key={k}
          ref={(el) => {
            if (el) flagEls.current.set(i, el);
            else flagEls.current.delete(i);
          }}
          className="ui-dctc__flag"
          data-on={on ? "" : undefined}
          tabIndex={0}
          aria-label={`${p.text} – the agent is unsure`}
          aria-describedby={on ? tipId : undefined}
          onMouseEnter={() => setHoverFlag(i)}
          onMouseLeave={() => setHoverFlag((h) => (h === i ? null : h))}
          onFocus={() => setPeek(i)}
          onBlur={() => setPeek((x) => (x === i ? null : x))}
        >
          {p.text}
        </mark>
      );
    });

  const tree = (d: Decision) => {
    const counter = { n: 0 };
    // Recorded: the branch you picked to look at is drawn through to its outcome – until then the one that was taken
    const shownPick = inspected ?? d.chosen;
    const p = recorded ? (shownPick !== undefined && shownPick !== null && d.options[shownPick] ? ({ id: keyOf(d), i: shownPick } as Picked) : null) : picked?.id === keyOf(d) ? picked : null;
    const otherIndex = d.options.length;
    // Recorded: the branch pointed at, else the one inspected, else the one taken lights up
    const focusIndex = hover ?? inspected ?? p?.i ?? null;
    const dim = (i: number) => (recorded ? focusIndex !== null && focusIndex !== i : p ? p.i !== i : hover !== null && hover !== i);
    const hot = (i: number) => (recorded ? focusIndex === i : p ? p.i === i : hover === i);
    // The follow-up of the picked branch: its options answer to the pointer, the keys and the pick
    const live = (i: number) => !!p && p.i === i && p.other === undefined;
    const sdim = (i: number, j: number) => live(i) && (p!.j !== undefined ? p!.j !== j : hover !== null && hover !== j);
    const shot = (i: number, j: number) => live(i) && (p!.j !== undefined ? p!.j === j : hover === j);
    const asking = !!p && p.other === undefined && p.j === undefined && !!d.options[p.i]?.next;
    const final = !!p && !asking;
    const apps = (list?: ReactNode[]) =>
      !!list?.length && (
        <span className="ui-dctc__apps" aria-hidden="true">
          {list.map((a, k) => (
            <span key={k} className="ui-dctc__app">
              {a}
            </span>
          ))}
        </span>
      );
    const label = (o: DecisionOption) => (
      <span className="ui-dctc__label">
        {o.icon && (
          <span className="ui-dctc__icon" aria-hidden="true">
            {o.icon}
          </span>
        )}
        <span className="ui-dctc__label-text" dir="auto">
          {o.label}
        </span>
      </span>
    );
    const row = (i: number, content: ReactNode, leaf?: ReactNode) => (
      <div key={i} className="ui-dctc__row" data-dim={dim(i) ? "" : undefined} style={{ "--i": i } as CSSProperties} onMouseEnter={() => (recorded || !p) && setHover(i)} onMouseLeave={() => (recorded || !p) && !otherOpen && setHover(null)}>
        {content}
        {leaf}
      </div>
    );
    return (
      <div ref={treeRef} key={keyOf(d)} className="ui-dctc__tree" data-picked={p ? "" : undefined} data-final={final ? "" : undefined} data-leaving={p?.leaving ? "" : undefined}>
        <svg className="ui-dctc__links" width={size.w} height={size.h} aria-hidden="true">
          {links.map((l) => {
            const o = d.options[l.b];
            const sub = l.s !== undefined ? o?.next?.options[l.s] : undefined;
            const pick = l.s !== undefined ? o?.pick && sub?.pick : o?.pick;
            return (
              <path
                key={l.id}
                pathLength={1}
                d={l.d}
                className="ui-dctc__link"
                data-kind={l.kind}
                data-pick={pick ? "" : undefined}
                data-hot={(l.s !== undefined ? shot(l.b, l.s) : hot(l.b)) ? "" : undefined}
                data-dim={dim(l.b) ? "" : undefined}
                data-soft={l.s !== undefined && sdim(l.b, l.s) ? "" : undefined}
                data-live={l.s !== undefined && live(l.b) ? "" : undefined}
                style={{ "--i": l.b, "--j": l.s ?? 0 } as CSSProperties}
              />
            );
          })}
        </svg>
        <div ref={tref("root")} className="ui-dctc__root">
          {(d.risk === "high" || d.risk === "medium") && (
            <span className="ui-dctc__risk" data-risk={d.risk}>
              {RISK[d.risk]}
            </span>
          )}
          <div className="ui-dctc__who">
            <span className="ui-dctc__avatar" aria-hidden="true">
              {d.icon ?? initial(d.agent)}
            </span>
            <span className="ui-dctc__meta">
              <span className="ui-dctc__agent" dir="auto" title={d.agent}>
                {d.agent}
              </span>
              {d.model && (
                <span className="ui-dctc__model" title={d.model}>
                  {d.model}
                </span>
              )}
            </span>
          </div>
          <h3 className="ui-dctc__q" dir="auto">
            {d.question}
          </h3>
          {d.context && (
            <p className="ui-dctc__context" dir="auto">
              {d.context}
            </p>
          )}
          {d.action && <div className="ui-dctc__action">{d.action}</div>}
        </div>
        <div className="ui-dctc__branches" role="group" aria-label="How should the agent go on?">
          {d.options.map((o, i) =>
            row(
              i,
              <button
                ref={tref(`opt:${i}`)}
                type="button"
                className="ui-dctc__opt"
                data-pick={o.pick ? "" : undefined}
                data-hot={hot(i) ? "" : undefined}
                data-pressed={pressed === `opt:${i}` ? "" : undefined}
                disabled={!recorded && !!p}
                aria-pressed={recorded ? inspected === i : undefined}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                aria-label={`${recorded && !(d.open && d.chosen === undefined) ? "Inspect " : ""}${o.label}${o.pick ? " – the agent's pick" : ""}${recorded && d.chosen === i ? " – recorded choice" : ""}`}
                onClick={() => choose(i)}
              >
                <kbd className="ui-dctc__kbd" data-off={i > 8 ? "" : undefined}>
                  {i + 1}
                </kbd>
                {label(o)}
                {o.pick && <span className="ui-dctc__pick">Agent's pick</span>}
              </button>,
              o.next ? (
                // The follow-up: its question, its options hanging off a rail – quiet until this branch is picked
                <div className="ui-dctc__sub" data-live={live(i) ? "" : undefined} data-asking={live(i) && asking ? "" : undefined}>
                  <div ref={tref(`subq:${i}`)} className="ui-dctc__subq" dir="auto">
                    {o.next.question}
                    {/* Narrow containers fold the options away until this branch is picked – this says what's inside */}
                    <span className="ui-dctc__more">{o.next.options.length} options</span>
                  </div>
                  <div className="ui-dctc__subopts" role="group" aria-label={o.next.question}>
                    {o.next.options.map((so, j) => (
                      <button
                        key={j}
                        ref={tref(`sopt:${i}:${j}`)}
                        type="button"
                        className="ui-dctc__sopt"
                        data-pick={o.pick && so.pick ? "" : undefined}
                        data-hot={shot(i, j) ? "" : undefined}
                        data-soft={sdim(i, j) ? "" : undefined}
                        data-pressed={pressed === `sopt:${i}:${j}` ? "" : undefined}
                        style={{ "--j": j } as CSSProperties}
                        disabled={!(live(i) && asking)}
                        tabIndex={live(i) && asking ? undefined : -1}
                        aria-keyshortcuts={live(i) && asking ? String(j + 1) : undefined}
                        aria-label={`${so.label}${o.pick && so.pick ? " – the agent's pick" : ""}`}
                        onMouseEnter={() => live(i) && asking && setHover(j)}
                        onMouseLeave={() => live(i) && asking && setHover(null)}
                        onClick={() => choose(j)}
                      >
                        <span className="ui-dctc__sopt-top">
                          {live(i) && asking && <kbd className="ui-dctc__kbd">{j + 1}</kbd>}
                          {label(so)}
                          {o.pick && so.pick && <span className="ui-dctc__pick">Agent's pick</span>}
                        </span>
                        {(!!so.effects?.length || !!so.apps?.length) && (
                          <span className="ui-dctc__sopt-effects">
                            <span className="ui-dctc__lines">
                              {(so.effects ?? []).map((e, k) => (
                                <span key={k} className="ui-dctc__effect" dir="auto">
                                  {text(e, counter)}
                                </span>
                              ))}
                            </span>
                            {apps(so.apps)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                (!!o.effects?.length || !!o.apps?.length) && (
                  <div ref={tref(`leaf:${i}`)} className="ui-dctc__leaf">
                    <span className="ui-dctc__lines">
                      {(o.effects ?? []).map((e, k) => (
                        <span key={k} className="ui-dctc__effect" dir="auto">
                          {text(e, counter)}
                        </span>
                      ))}
                    </span>
                    {apps(o.apps)}
                  </div>
                )
              ),
            ),
          )}
          {/* Other…: your own instruction, as a prompt for the agent */}
          {allowOther &&
            row(
              otherIndex,
              <div ref={tref(`opt:${otherIndex}`)} className="ui-dctc__opt" data-other="" data-open={otherOpen || p?.other ? "" : undefined} data-hot={hot(otherIndex) ? "" : undefined}>
                {p?.other ? (
                  <span className="ui-dctc__said" dir="auto">
                    {p.other}
                  </span>
                ) : otherOpen ? (
                  <div ref={growRef} className="ui-dctc__grow">
                    {/* The mirror measures the text, so the box can glide to its height */}
                    <span ref={mirrorRef} className="ui-dctc__mirror" aria-hidden="true">
                      {other || "Tell the agent what to do instead…"}
                      {"​"}
                    </span>
                    <textarea
                      ref={otherRef}
                      className="ui-dctc__input"
                      value={other}
                      rows={2}
                      placeholder="Tell the agent what to do instead…"
                      aria-label={`Your own instruction for the ${(d.agent.trim() || "Agent").toLowerCase()} – Enter sends, Shift+Enter for a new line`}
                      onChange={(e) => setOther(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setOtherOpen(false);
                          setHover(null);
                          rootRef.current?.focus({ preventScroll: true });
                          return;
                        }
                        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        send();
                      }}
                    />
                  </div>
                ) : (
                  <button type="button" className="ui-dctc__other" data-pressed={pressed === "other" ? "" : undefined} disabled={!!p} aria-keyshortcuts={otherIndex < 9 ? String(otherIndex + 1) : undefined} onClick={() => choose(otherIndex)}>
                    <kbd className="ui-dctc__kbd" data-off={otherIndex > 8 ? "" : undefined}>
                      {otherIndex + 1}
                    </kbd>
                    <span className="ui-dctc__label">Other…</span>
                  </button>
                )}
              </div>,
            )}
        </div>
        {final && p && (
          <div ref={tref("out")} className="ui-dctc__out" data-kind={p.other !== undefined ? "replied" : "approved"}>
            {p.other !== undefined ? (
              <>
                <span className="ui-dctc__out-head">
                  <Tick />
                  Sent to the {(d.agent.trim() || "Agent").toLowerCase()}
                </span>
                {p.answer ? (
                  <span className="ui-dctc__answer">{p.answer}</span>
                ) : (
                  <span className="ui-dctc__typing" aria-label={`${d.agent} is typing`}>
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </>
            ) : (
              <span className="ui-dctc__out-head">
                <Tick />
                {recorded ? (outcome?.(d, p.i) ?? "Recorded choice") : <>Approved <span className="ui-dctc__running">· running</span></>}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Eight dots at most – they move along so the current one is always among them
  const dotsFrom = Math.max(0, Math.min(index - 3, list.length - 8));

  return (
    <div
      ref={rootRef}
      className={["ui-dctc", className].filter(Boolean).join(" ")}
      data-recorded={recorded ? "" : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // A click on plain content keeps the keys working
        if (!(e.target as HTMLElement).closest("button, a, input, textarea, mark")) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
      }}
    >
      <style href="ui-decision-tree-clean" precedence="default">
        {css}
      </style>

      <header className="ui-dctc__head">
        <span className="ui-dctc__mark">
          <Branches />
        </span>
        <span className="ui-dctc__heading" title={title}>
          {title}
        </span>
        <span className="ui-dctc__count">{countLabel && current ? countLabel(index, list.length) : list.length ? `${fmt.format(list.length)} waiting for you` : `${fmt.format(decided)} of ${fmt.format(total)} decided`}</span>
        {current && list.length > 1 && (
          <span className="ui-dctc__pager" aria-label={`Decision ${fmt.format(index + 1)} of ${fmt.format(list.length)}`}>
            <span className="ui-dctc__dots" aria-hidden="true">
              {list.slice(dotsFrom, dotsFrom + 8).map((x, k) => (
                <span key={keyOf(x)} data-on={dotsFrom + k === index ? "" : undefined} />
              ))}
            </span>
            <span className="ui-dctc__of">
              {fmt.format(index + 1)} of {fmt.format(list.length)}
            </span>
          </span>
        )}
        {actions && <span className="ui-dctc__actions">{actions}</span>}
      </header>

      <div ref={bodyRef} className="ui-dctc__body" data-narrow={narrow ? "" : undefined}>
        {current ? (
          tree(current)
        ) : (
          <div className="ui-dctc__empty">
            <span className="ui-dctc__empty-mark">
              <Badge size={22} />
            </span>
            <b>All decided</b>
            <span>New decisions from your agents show up here.</span>
          </div>
        )}
        {tipFlag && (
          <div ref={tipRef} id={tipId} role="tooltip" className="ui-dctc__tip" key={tipIndex}>
            <span className="ui-dctc__tip-head">
              <Alert />
              Agent's note
            </span>
            <p>{tipFlag.note}</p>
            {tipFlag.source && <span className="ui-dctc__tip-source">{tipFlag.source}</span>}
          </div>
        )}
        {current && waiting && (
          <p className="ui-dctc__hint" aria-hidden="true" key="then">
            Then <kbd className="ui-dctc__kbd">1</kbd>–<kbd className="ui-dctc__kbd">{Math.min(9, waiting.options.length)}</kbd>
          </p>
        )}
        {current && (recorded || !picked) && current.options.length > 0 && (
          <p className="ui-dctc__hint" aria-hidden="true">
            {recorded && !(current.open && current.chosen === undefined) ? "Inspect a branch" : "Pick a branch"} <kbd className="ui-dctc__kbd">1</kbd>–<kbd className="ui-dctc__kbd">{Math.min(9, current.options.length + (allowOther ? 1 : 0))}</kbd>
            {list.length > 1 && (
              <>
                <span>·</span> next <kbd className="ui-dctc__kbd">→</kbd>
              </>
            )}
          </p>
        )}
      </div>
      <div className="ui-dctc__sr" aria-live="polite" aria-atomic="true">
        {said}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-dctc */
.ui-dctc {
  --ui-dctc-card: #ffffff;
  --ui-dctc-strong: var(--aui-ink, #000000);
  --ui-dctc-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-dctc-text: var(--aui-muted, rgba(0, 0, 0, 0.61));
  --ui-dctc-muted: var(--aui-muted, rgba(0, 0, 0, 0.45));
  --ui-dctc-faint: var(--aui-placeholder, rgba(0, 0, 0, 0.27));
  --ui-dctc-line: var(--aui-border, rgba(0, 0, 0, 0.06));
  --ui-dctc-line-strong: rgba(0, 0, 0, 0.12);
  --ui-dctc-fill: var(--aui-subtle, rgba(0, 0, 0, 0.06));
  --ui-dctc-leaf-bg: var(--aui-subtle, rgba(0, 0, 0, 0.015));
  --ui-dctc-accent: rgba(0, 96, 226, 0.765);
  --ui-dctc-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  /* Lines: idle, the agent's pick, the path you point at or picked */
  --ui-dctc-link: rgba(0, 0, 0, 0.15);
  --ui-dctc-link-pick: rgba(0, 96, 226, 0.42);
  --ui-dctc-link-hot: rgba(0, 0, 0, 0.38);
  --ui-dctc-link-pick-hot: rgba(0, 96, 226, 0.6);
  --ui-dctc-high-bg: #f52b0018;
  --ui-dctc-high-fg: #d72400da;
  --ui-dctc-mid-bg: #ff9c0024;
  --ui-dctc-mid-fg: var(--aui-warning, #b25e00);
  --ui-dctc-ok-bg: #00a43319;
  --ui-dctc-ok-edge: color-mix(in srgb, var(--aui-green, #5fc88a) 30%, transparent);
  --ui-dctc-ok-fg: #007d2ee0;
  --ui-dctc-flag-bg: color-mix(in srgb, var(--aui-amber, #e8b000) 16%, transparent);
  --ui-dctc-flag-edge: color-mix(in srgb, var(--aui-orange, #f28a2e) 55%, transparent);
  --ui-dctc-flag-hot: color-mix(in srgb, var(--aui-amber, #e8b000) 28%, transparent);
  --ui-dctc-flag-ink: var(--aui-warning, #b25e00);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-dctc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-dctc-raised: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 1px -1px rgba(0, 0, 0, 0.12), 0 2px 4px 0 rgba(0, 0, 0, 0.05);
  --ui-dctc-lift: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 4px 12px -4px rgba(0, 0, 0, 0.14), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
  --ui-dctc-lift-hot: 0 0 0 0.5px rgba(0, 0, 0, 0.07), 0 8px 20px -6px rgba(0, 0, 0, 0.18), 0 1px 3px 0 rgba(0, 0, 0, 0.07);
  --ui-dctc-pick-lift: 0 0 0 0.5px rgba(0, 96, 226, 0.24), 0 3px 8px -4px rgba(0, 96, 226, 0.14), 0 1px 2px 0 color-mix(in srgb, var(--aui-blue, #0190fe) 5%, transparent);
  --ui-dctc-pick-lift-hot: 0 0 0 0.5px rgba(0, 96, 226, 0.42), 0 8px 22px -6px rgba(0, 96, 226, 0.34), 0 2px 4px -1px rgba(0, 96, 226, 0.16);
  --ui-dctc-pop: var(--aui-shadow-popover, 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05));
  --ui-dctc-height: 400px;
  --ui-dctc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  outline: none;
  container: ui-dctc / inline-size;
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-dctc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-dctc *, .ui-dctc *::before, .ui-dctc *::after { box-sizing: border-box; }
:where(.ui-dctc) :is(button, textarea) { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; -webkit-tap-highlight-color: transparent; }
:where(.ui-dctc) button { cursor: pointer; }
:where(.ui-dctc) button:disabled { cursor: default; }
.ui-dctc :is(button, mark):focus-visible { outline: 2px solid var(--ui-dctc-focus); outline-offset: 2px; }
:where(.ui-dctc) :is(p, h3) { margin: 0; }
.ui-dctc svg { display: block; flex: none; }
.ui-dctc__kbd { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: calc(var(--aui-radius-sm, 5px) - 1px); background: var(--ui-dctc-fill); font-family: inherit; font-size: 10.5px; font-weight: 500; line-height: 1; color: var(--ui-dctc-muted); letter-spacing: 0; }
.ui-dctc__kbd[data-off] { visibility: hidden; }
.ui-dctc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- The bar: what this is, how many wait, where you are ----- */
.ui-dctc__head { display: flex; align-items: center; gap: 8px; min-width: 0; margin-bottom: 16px; }
/* Agent Relay: the page's controls at the end of the title row, and a link under the question */
.ui-dctc__actions { display: inline-flex; flex: none; align-items: center; gap: 4px; margin-left: 4px; }
.ui-dctc__action { margin-top: 10px; }
/* Recorded: the other branches step back but stay – one click shows where they led instead */
.ui-dctc[data-recorded] .ui-dctc__tree[data-picked] .ui-dctc__row[data-dim] { opacity: 0.4; pointer-events: auto; }
.ui-dctc[data-recorded] .ui-dctc__tree[data-picked] .ui-dctc__row[data-dim]:hover { opacity: 0.75; }
.ui-dctc[data-recorded] .ui-dctc__tree[data-picked] .ui-dctc__link[data-dim] { opacity: 0.25; }
.ui-dctc__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-dctc-accent); }
.ui-dctc__heading { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-dctc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-dctc__count { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; color: var(--ui-dctc-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-dctc__pager { display: inline-flex; flex: none; align-items: center; gap: 10px; font-size: 12px; line-height: 16px; color: var(--ui-dctc-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-dctc__dots { display: flex; gap: 4px; }
.ui-dctc__dots > span { width: 5px; height: 5px; border-radius: 1.5px; background: var(--ui-dctc-line-strong); transition: background-color 240ms ease, transform 240ms var(--ui-dctc-ease); }
.ui-dctc__dots > span[data-on] { background: var(--ui-dctc-ink); transform: scale(1.15); }

/* ----- The card with the tree ----- */
.ui-dctc__body { position: relative; display: flex; align-items: center; justify-content: center; min-height: var(--ui-dctc-height); padding: 28px 0 44px; }
.ui-dctc__tree { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(0, 204px) minmax(0, 1fr); align-items: center; column-gap: 28px; width: 100%; max-width: 900px; transition: opacity 260ms ease; }
.ui-dctc__tree[data-leaving] { opacity: 0; }
.ui-dctc__links { position: absolute; top: 0; left: 0; z-index: -1; overflow: visible; pointer-events: none; }
/* Thin neutral hairlines that draw themselves in – the agent's pick a quiet blue, the path you point at a little stronger */
.ui-dctc__link { fill: none; stroke: var(--ui-dctc-link); stroke-width: 0.5px; stroke-linecap: round; stroke-dasharray: 1 1; animation: ui-dctc-draw 460ms var(--ui-dctc-ease) calc(180ms + var(--i, 0) * 80ms) both; transition: stroke 220ms ease, opacity 260ms ease, stroke-width 220ms ease; }
.ui-dctc__link[data-kind="leaf"] { animation-delay: calc(360ms + var(--i, 0) * 80ms); }
.ui-dctc__link[data-kind="out"] { animation: ui-dctc-draw 380ms var(--ui-dctc-ease) 120ms both; }
.ui-dctc__link[data-kind="sub"] { animation-delay: calc(520ms + var(--i, 0) * 80ms + var(--j, 0) * 60ms); }
/* A follow-up's lines stay quiet until its branch is picked; then the ones you don't point at step back */
.ui-dctc__link[data-kind="sub"]:not([data-live]) { opacity: 0.6; }
.ui-dctc__link[data-soft] { opacity: 0.25; }
.ui-dctc__tree[data-final] .ui-dctc__link[data-soft] { opacity: 0; }
.ui-dctc__link[data-pick] { stroke: var(--ui-dctc-link-pick); }
.ui-dctc__link[data-hot] { stroke: var(--ui-dctc-link-hot); stroke-width: 1.25px; }
.ui-dctc__link[data-pick][data-hot] { stroke: var(--ui-dctc-link-pick-hot); }
.ui-dctc__link[data-dim] { opacity: 0.25; }
.ui-dctc__tree[data-picked] .ui-dctc__link[data-dim] { opacity: 0; }

/* The question */
.ui-dctc__root { grid-template-columns: minmax(0, 1fr); position: relative; display: grid; gap: 10px; padding: 14px 16px 15px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-surface, var(--ui-dctc-card)); box-shadow: var(--aui-shadow-card, var(--ui-dctc-shadow)); animation: ui-dctc-node 420ms var(--ui-dctc-ease) 40ms backwards; }
/* Logo, then the agent's name with its model under it */
.ui-dctc__who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ui-dctc__avatar { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 6px; background: var(--ui-dctc-card); box-shadow: var(--ui-dctc-shadow); font-size: 12px; font-weight: 500; color: var(--ui-dctc-text); }
.ui-dctc__avatar > :is(svg, img) { width: 14px; height: 14px; object-fit: contain; }
/* Logos of any size stay in their tile */
.ui-dctc__avatar, .ui-dctc__icon, .ui-dctc__app { overflow: hidden; }
.ui-dctc__meta { display: grid; flex: 1; gap: 1px; min-width: 0; }
.ui-dctc__agent { overflow: hidden; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-dctc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-dctc__model { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-dctc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* The risk tag: a tint with its color, like the Live tag in Trace Waterfall – outside the card, just above its top left */
.ui-dctc__risk { position: absolute; bottom: calc(100% + 6px); left: 2px; display: inline-flex; flex: none; align-items: center; height: 20px; padding: 0 7px; border-radius: var(--aui-radius-sm, 5px); background: var(--k-bg); font-size: 11.5px; font-weight: 500; line-height: 16px; color: var(--k-fg); white-space: nowrap; }
.ui-dctc [data-risk="high"] { --k-bg: var(--ui-dctc-high-bg); --k-fg: var(--ui-dctc-high-fg); }
.ui-dctc [data-risk="medium"] { --k-bg: var(--ui-dctc-mid-bg); --k-fg: var(--ui-dctc-mid-fg); }
.ui-dctc__q { font-size: 13.5px; font-weight: 500; line-height: 20px; color: var(--ui-dctc-strong); text-wrap: pretty; overflow-wrap: anywhere; }
.ui-dctc__context { margin-top: -4px; font-size: 12px; line-height: 17px; color: var(--ui-dctc-muted); text-wrap: pretty; overflow-wrap: anywhere; white-space: pre-line; }

/* The branches: an option card, then its consequences in muted text */
.ui-dctc__branches { display: grid; gap: 14px; }
.ui-dctc__row { display: grid; grid-template-columns: minmax(0, 184px) minmax(0, 1fr); align-items: center; column-gap: 24px; transition: opacity 280ms ease; animation: ui-dctc-node 420ms var(--ui-dctc-ease) calc(140ms + var(--i, 0) * 80ms) backwards; }
.ui-dctc__row[data-dim] { opacity: 0.38; }
.ui-dctc__tree[data-picked] .ui-dctc__row[data-dim] { opacity: 0; pointer-events: none; }
.ui-dctc__opt { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 2px 8px; min-width: 0; padding: 9px 12px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-surface, var(--ui-dctc-card)); box-shadow: var(--aui-shadow-card, var(--ui-dctc-shadow)); text-align: left; transition: box-shadow 200ms ease, transform 140ms ease; }
/* Highlighted boxes lift with a deeper shadow instead of a darker stroke */
button.ui-dctc__opt:hover:not(:disabled), .ui-dctc__opt[data-hot] { box-shadow: var(--ui-dctc-lift-hot); }
/* The agent's pick: the same lift, tinted blue, with a faint blue edge */
.ui-dctc__opt[data-pick] { box-shadow: var(--ui-dctc-pick-lift); }
button.ui-dctc__opt[data-pick]:hover:not(:disabled), .ui-dctc__opt[data-pick][data-hot] { box-shadow: var(--ui-dctc-pick-lift-hot); }
.ui-dctc__opt[data-pressed] { transform: scale(0.98); }
.ui-dctc__label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-dctc-ink); }
/* The tool an option runs with: its logo on a small white tile */
.ui-dctc__icon { display: grid; flex: none; place-items: center; width: 18px; height: 18px; border-radius: 5px; background: var(--ui-dctc-card); box-shadow: var(--ui-dctc-shadow); }
.ui-dctc__icon > :is(svg, img) { width: 11px; height: 11px; object-fit: contain; }
/* The systems a consequence touches: a row of the same tiles, slightly overlapping */
.ui-dctc__lines { display: grid; gap: 1px; min-width: 0; }
.ui-dctc__apps { display: flex; flex: none; }
.ui-dctc__app { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--ui-dctc-card); box-shadow: var(--ui-dctc-shadow), 0 0 0 1.5px var(--ui-dctc-card); }
.ui-dctc__app + .ui-dctc__app { margin-left: -3px; }
.ui-dctc__app > :is(svg, img) { width: 12px; height: 12px; object-fit: contain; }
.ui-dctc__pick { grid-column: 2; font-size: 11.5px; line-height: 14px; color: var(--ui-dctc-accent); }
.ui-dctc__leaf { display: flex; align-items: center; gap: 12px; justify-self: start; min-width: 0; padding: 8px 12px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--ui-dctc-leaf-bg); box-shadow: inset 0 0 0 0.5px var(--ui-dctc-line); animation: ui-dctc-node 420ms var(--ui-dctc-ease) calc(300ms + var(--i, 0) * 80ms) backwards; }
.ui-dctc__effect { font-size: 12.5px; line-height: 18px; color: var(--ui-dctc-text); overflow-wrap: anywhere; white-space: pre-line; }
.ui-dctc__label-text { min-width: 0; overflow-wrap: anywhere; }

/* A follow-up: a small question card, its options hanging off a rail under it – quiet until its branch is picked */
.ui-dctc__sub { display: grid; gap: 8px; justify-items: start; min-width: 0; transition: opacity 280ms ease; animation: ui-dctc-node 420ms var(--ui-dctc-ease) calc(300ms + var(--i, 0) * 80ms) backwards; }
.ui-dctc__sub:not([data-live]) { opacity: 0.62; }
.ui-dctc__subq { max-width: 100%; overflow-wrap: anywhere; padding: 6px 10px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-surface, var(--ui-dctc-card)); box-shadow: var(--aui-shadow-card, var(--ui-dctc-shadow)); font-size: 12.5px; font-weight: 500; line-height: 17px; color: var(--ui-dctc-ink); text-wrap: pretty; }
.ui-dctc__subopts { display: grid; gap: 6px; justify-items: start; padding-left: 22px; }
.ui-dctc__sopt { display: grid; gap: 2px; min-width: 0; max-width: 100%; padding: 6px 10px 7px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-surface, var(--ui-dctc-card)); box-shadow: var(--aui-shadow-card, var(--ui-dctc-shadow)); text-align: left; transition: box-shadow 200ms ease, opacity 280ms ease, transform 140ms ease; animation: ui-dctc-node 420ms var(--ui-dctc-ease) calc(560ms + var(--i, 0) * 80ms + var(--j, 0) * 60ms) backwards; }
.ui-dctc__sopt[data-pick] { box-shadow: var(--ui-dctc-pick-lift); }
button.ui-dctc__sopt:hover:not(:disabled), .ui-dctc__sopt[data-hot] { box-shadow: var(--ui-dctc-lift-hot); }
button.ui-dctc__sopt[data-pick]:hover:not(:disabled), .ui-dctc__sopt[data-pick][data-hot] { box-shadow: var(--ui-dctc-pick-lift-hot); }
.ui-dctc__sopt[data-pressed] { transform: scale(0.98); }
.ui-dctc__sopt[data-soft] { opacity: 0.38; }
.ui-dctc__tree[data-final] .ui-dctc__sopt[data-soft] { opacity: 0; pointer-events: none; }
.ui-dctc__sopt-top { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
.ui-dctc__sopt .ui-dctc__label { font-size: 12.5px; }
.ui-dctc__sopt .ui-dctc__pick { grid-column: auto; }
.ui-dctc__sopt-effects { display: flex; align-items: center; gap: 10px; }
.ui-dctc__sopt .ui-dctc__effect { font-size: 12px; line-height: 17px; }
.ui-dctc__more { display: none; margin-left: 6px; font-weight: 400; color: var(--ui-dctc-muted); white-space: nowrap; }
/* While the follow-up waits for you, its question lifts a little */
.ui-dctc__sub[data-asking] .ui-dctc__subq { box-shadow: var(--ui-dctc-raised); }
/* A part the agent isn't sure about: a warm tint with a hairline underline – brighter while its note shows */
.ui-dctc__flag { padding: 1px 2px; margin: 0 -1px; border-radius: 3px; background: var(--ui-dctc-flag-bg); box-shadow: inset 0 -1px 0 var(--ui-dctc-flag-edge); color: var(--ui-dctc-flag-ink); cursor: help; -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background-color 160ms ease, box-shadow 160ms ease; }
.ui-dctc__flag:is(:hover, [data-on]) { background: var(--ui-dctc-flag-hot); box-shadow: inset 0 0 0 0.5px var(--ui-dctc-flag-edge); }

/* Other…: a quiet outline; opened, a field that grows with what you write – no focus ring, its hairline darkens */
.ui-dctc__opt[data-other] { padding: 0; background: transparent; box-shadow: inset 0 0 0 0.5px var(--aui-border-strong, var(--ui-dctc-line-strong)); }
.ui-dctc__opt[data-other][data-open] { background: var(--aui-surface, var(--ui-dctc-card)); }
.ui-dctc__opt[data-other][data-open]:focus-within { box-shadow: inset 0 0 0 0.5px var(--ui-dctc-link-hot); }
.ui-dctc__other { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 12px; border-radius: inherit; text-align: left; }
.ui-dctc__other .ui-dctc__label { font-weight: 400; color: var(--ui-dctc-muted); }
.ui-dctc__grow { position: relative; height: 32px; overflow: hidden; transition: height 250ms var(--ui-dctc-ease); }
.ui-dctc__mirror { position: absolute; top: 0; right: 0; left: 0; padding: 6px 12px; font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; visibility: hidden; pointer-events: none; }
.ui-dctc__input { display: block; width: 100%; height: 100%; padding: 6px 12px; font-size: 13px; line-height: 20px; color: var(--ui-dctc-ink); resize: none; overflow-y: hidden; outline: none; scrollbar-width: thin; }
.ui-dctc .ui-dctc__input:focus-visible { outline: none; }
.ui-dctc__input::placeholder { color: var(--ui-dctc-muted); }
.ui-dctc__said { padding: 6px 12px; font-size: 13px; line-height: 20px; color: var(--ui-dctc-ink); white-space: pre-wrap; overflow-wrap: anywhere; }

/* The outcome under the picked path */
.ui-dctc__out { position: absolute; z-index: 1; display: grid; gap: 6px; max-width: 280px; padding: 9px 12px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-surface, var(--ui-dctc-card)); box-shadow: var(--ui-dctc-raised), 0 0 0 0.5px var(--ui-dctc-ok-edge); animation: ui-dctc-node 360ms var(--ui-dctc-ease) 320ms backwards; }
.ui-dctc__out[data-kind="replied"] { box-shadow: var(--ui-dctc-lift); }
.ui-dctc__out-head { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 500; color: var(--ui-dctc-ink); overflow-wrap: anywhere; }
.ui-dctc__out-head > svg { width: 15px; height: 15px; color: var(--ui-dctc-ok-fg); }
.ui-dctc__running { font-weight: 400; color: var(--ui-dctc-muted); }
.ui-dctc__answer { font-size: 12.5px; line-height: 18px; color: var(--ui-dctc-text); animation: ui-dctc-fade-up 280ms var(--ui-dctc-ease) backwards; overflow-wrap: anywhere; }
.ui-dctc__typing { display: inline-flex; gap: 4px; justify-self: start; padding: 6px 0 4px; }
.ui-dctc__typing > span { width: 5px; height: 5px; border-radius: 50%; background: var(--ui-dctc-muted); animation: ui-dctc-dot 1100ms ease-in-out infinite; }
.ui-dctc__typing > span:nth-child(2) { animation-delay: 150ms; }
.ui-dctc__typing > span:nth-child(3) { animation-delay: 300ms; }

.ui-dctc__hint { position: absolute; bottom: 8px; left: 0; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ui-dctc-muted); pointer-events: none; animation: ui-dctc-fade 300ms ease 600ms backwards; }
.ui-dctc__hint > span { margin: 0 3px; color: var(--ui-dctc-faint); }

/* The agent's note on a flagged part */
.ui-dctc__tip { position: absolute; top: 0; left: 0; z-index: 6; display: grid; gap: 2px; width: min(300px, calc(100% - 20px)); padding: 10px 12px 11px; border-radius: var(--aui-radius-lg, 10px); background: var(--aui-overlay, var(--ui-dctc-card)); box-shadow: var(--ui-dctc-pop); pointer-events: none; transform-origin: var(--x, 50%) top; animation: ui-dctc-tip 200ms var(--ui-dctc-ease) both; }
.ui-dctc__tip[data-side="above"] { transform-origin: var(--x, 50%) bottom; }
.ui-dctc__tip-head { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 500; line-height: 16px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ui-dctc-mid-fg); }
.ui-dctc__tip-head > svg { width: 12px; height: 12px; }
.ui-dctc__tip p { font-size: 12.5px; line-height: 18px; color: var(--ui-dctc-ink); text-wrap: pretty; overflow-wrap: anywhere; }
.ui-dctc__tip-source { justify-self: start; margin-top: 2px; padding: 1px 7px; border-radius: calc(var(--aui-radius-sm, 5px) - 1px); background: var(--ui-dctc-fill); font-size: 11.5px; line-height: 16px; color: var(--ui-dctc-text); max-width: 100%; overflow-wrap: anywhere; }

.ui-dctc__empty { display: grid; justify-items: center; gap: 4px; text-align: center; animation: ui-dctc-fade-up 360ms var(--ui-dctc-ease) both; }
.ui-dctc__empty-mark { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px; border-radius: 10px; background: var(--ui-dctc-card); color: var(--ui-dctc-ok-fg); box-shadow: var(--ui-dctc-shadow), 0 0 0 4px var(--ui-dctc-ok-bg); }
.ui-dctc__empty b { font-size: 15px; font-weight: 500; line-height: 22px; color: var(--ui-dctc-strong); }
.ui-dctc__empty > span:last-child { font-size: 13px; color: var(--ui-dctc-muted); }

/* ----- Narrow: top to bottom – the question, then each branch hanging off a rail with its consequences under it ----- */
@container ui-dctc (max-width: 639px) {
  .ui-dctc__body { min-height: 0; padding: 24px 0 40px; }
  .ui-dctc__count { display: none; }
  .ui-dctc__tree { grid-template-columns: minmax(0, 1fr); row-gap: 18px; }
  .ui-dctc__branches { padding-left: 34px; }
  .ui-dctc__row { grid-template-columns: minmax(0, 1fr); row-gap: 8px; }
  .ui-dctc__leaf, .ui-dctc__sub { margin-left: 26px; }
  .ui-dctc__subopts { padding-left: 22px; }
  /* A follow-up folds to its question until its branch is picked – then its options unfold */
  .ui-dctc__sub:not([data-live]) .ui-dctc__subopts { display: none; }
  .ui-dctc__sub:not([data-live]) .ui-dctc__more { display: inline; }
  .ui-dctc__sub[data-live] .ui-dctc__sopt { animation-delay: calc(120ms + var(--j, 0) * 60ms); }
  .ui-dctc__link[data-kind="sub"] { animation-delay: calc(80ms + var(--j, 0) * 60ms); }
  .ui-dctc__hint { left: 0; bottom: 8px; }
  .ui-dctc__hint kbd:last-of-type, .ui-dctc__hint > span { display: none; }
}
@container ui-dctc (max-width: 380px) {
  .ui-dctc__of { display: none; }
  .ui-dctc__branches { padding-left: 26px; }
  .ui-dctc__leaf, .ui-dctc__sub { margin-left: 18px; }
}

@keyframes ui-dctc-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes ui-dctc-node { from { opacity: 0; transform: translateX(-8px); } }
@keyframes ui-dctc-fade { from { opacity: 0; } }
@keyframes ui-dctc-fade-up { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-dctc-tip { from { opacity: 0; transform: translateY(4px) scale(0.96); } }
@keyframes ui-dctc-dot { 0%, 60%, 100% { opacity: 0.35; } 30% { opacity: 1; } }

@media (pointer: coarse) {
  .ui-dctc .ui-dctc__kbd, .ui-dctc__hint { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-dctc *, .ui-dctc *::before, .ui-dctc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-dctc {
  --ui-dctc-card: #1c1c1f;
  --ui-dctc-strong: var(--aui-ink, #ffffff);
  --ui-dctc-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-dctc-text: var(--aui-muted, rgba(255, 255, 255, 0.62));
  --ui-dctc-muted: var(--aui-muted, rgba(255, 255, 255, 0.45));
  --ui-dctc-faint: var(--aui-placeholder, rgba(255, 255, 255, 0.28));
  --ui-dctc-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-dctc-line-strong: rgba(255, 255, 255, 0.16);
  --ui-dctc-fill: var(--aui-subtle, rgba(255, 255, 255, 0.08));
  --ui-dctc-leaf-bg: var(--aui-subtle, rgba(255, 255, 255, 0.02));
  --ui-dctc-accent: var(--aui-blue, #4fb0fe);
  --ui-dctc-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-dctc-link: rgba(255, 255, 255, 0.16);
  --ui-dctc-link-pick: color-mix(in srgb, var(--aui-blue, #4fb0fe) 50%, transparent);
  --ui-dctc-link-hot: rgba(255, 255, 255, 0.36);
  --ui-dctc-link-pick-hot: color-mix(in srgb, var(--aui-blue, #4fb0fe) 70%, transparent);
  --ui-dctc-high-bg: #ff35232b;
  --ui-dctc-high-fg: var(--aui-danger, #ff8a7a);
  --ui-dctc-mid-bg: #fb6a0025;
  --ui-dctc-mid-fg: var(--aui-warning, #ffb35c);
  --ui-dctc-ok-bg: #00f04a1f;
  --ui-dctc-ok-edge: color-mix(in srgb, var(--aui-green, #7dcf9f) 36%, transparent);
  --ui-dctc-ok-fg: var(--aui-green, #5fc88a);
  --ui-dctc-flag-bg: color-mix(in srgb, var(--aui-orange, #f2a15c) 16%, transparent);
  --ui-dctc-flag-edge: color-mix(in srgb, var(--aui-orange, #f2a15c) 55%, transparent);
  --ui-dctc-flag-hot: color-mix(in srgb, var(--aui-orange, #f2a15c) 28%, transparent);
  --ui-dctc-flag-ink: #ffc88a;
  --ui-dctc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-dctc-raised: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 1px 3px 0 rgba(0, 0, 0, 0.5);
  --ui-dctc-lift: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 6px 16px -4px rgba(0, 0, 0, 0.6), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-dctc-lift-hot: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 10px 24px -6px rgba(0, 0, 0, 0.7), 0 1px 3px 0 rgba(0, 0, 0, 0.5);
  --ui-dctc-pick-lift: 0 0 0 0.5px color-mix(in srgb, var(--aui-blue, #4fb0fe) 34%, transparent), 0 4px 12px -4px color-mix(in srgb, var(--aui-blue, #4fb0fe) 24%, transparent), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-dctc-pick-lift-hot: 0 0 0 0.5px color-mix(in srgb, var(--aui-blue, #4fb0fe) 55%, transparent), 0 10px 26px -6px color-mix(in srgb, var(--aui-blue, #4fb0fe) 50%, transparent), 0 2px 5px -1px color-mix(in srgb, var(--aui-blue, #4fb0fe) 25%, transparent);
  --ui-dctc-pop: var(--aui-shadow-popover, 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6));
}
`;
