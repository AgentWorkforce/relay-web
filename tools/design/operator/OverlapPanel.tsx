// An overlap in the side panel, in the same sections, icons and rows as the rest of the panel.
// Overview: what happened, the facts, both sides and what to do. Evidence: what was shared and
// what each side recorded – so the operator can judge it, not just believe it.
import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  Clock,
  Coins,
  Copy,
  FileText,
  FolderOpen,
  Gauge,
  GitBranch,
  GitCompareArrows,
  History,
  Lightbulb,
  ListTodo,
  MessagesSquare,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, formatTokens, type Overview } from "./model";
import type { Pick } from "./OperatorV1";
import type { Overlap, OverlapCategory, OverlapKind } from "./overlaps";
import { CATEGORY_LABELS } from "./overlaps";
import { CumulativeChart, Initials, SessionRow } from "./WeekPanel";

export const OVERLAP_TABS = ["Overview", "Evidence"] as const;

export const KIND_ICONS: Record<OverlapKind, LucideIcon> = {
  concurrent_edit: GitCompareArrows,
  duplicate_work: Copy,
  superseded_work: History,
  repeated_investigation: Repeat,
  stale_base: Clock,
};
const ARTIFACT_ICONS = { file: FileText, branch: GitBranch, task: ListTodo } as const;

/** The category as a small colored marker with its name */
export function CategoryTag({ category }: { category: OverlapCategory }) {
  return (
    <span className="o-cat" data-cat={category}>
      <span className="o-cat__dot" aria-hidden="true" />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function KindLabel({ item }: { item: Overlap }) {
  const Icon = KIND_ICONS[item.kind];
  return (
    <span className="o-kind">
      <Icon size={14} aria-hidden="true" /> {item.kindLabel}
    </span>
  );
}

const talked = (c: Overlap["communication"]) =>
  c === "observed" ? "Yes, over the relay" : c === "not_observed" ? "No sign of it" : "Unknown";

export function OverlapDetail({ item, tab, onSession }: { item: Overlap; tab: string; onSession: (id: string) => void }) {
  return (
    <div className="o-week o-week--detail">
      {tab === "Overview" ? (
        <>
          <section className="o-card" aria-label={item.title}>
            <div className="o-card__head">
              <CategoryTag category={item.category} />
              <h2 className="o-card__name">{item.title}</h2>
              <p className="o-card__sub">{item.explanation}</p>
            </div>
            <dl className="o-props">
              <dt>Kind</dt>
              <dd>
                <KindLabel item={item} />
              </dd>
              {item.initiative && (
                <>
                  <dt>Initiative</dt>
                  <dd>
                    <FolderOpen size={14} aria-hidden="true" /> {item.initiative}
                  </dd>
                </>
              )}
              <dt>Talked?</dt>
              <dd>
                <MessagesSquare size={14} aria-hidden="true" /> {talked(item.communication)}
              </dd>
              <dt>Spent twice</dt>
              <dd className={item.duplicateTokens === null ? "o-props__muted" : undefined}>
                <Coins size={14} aria-hidden="true" /> {item.duplicateTokens === null ? "Nothing" : `~${formatTokens(item.duplicateTokens)} tokens`}
              </dd>
              <dt>Confidence</dt>
              <dd>
                <Gauge size={14} aria-hidden="true" /> {item.confidence.charAt(0).toUpperCase() + item.confidence.slice(1)}
              </dd>
              <dt>Detected</dt>
              <dd>
                <Clock size={14} aria-hidden="true" /> {ago(item.detectedAt, fixtureClock)}
              </dd>
            </dl>
          </section>
          <section className="o-card" aria-label="Both sides">
            <h3 className="o-card__title">Both sides</h3>
            <ul className="o-activity">
              {item.sides.map((s) => (
                <SessionRow key={s.id} s={s} onOpen={() => onSession(s.id)} />
              ))}
            </ul>
          </section>
          {item.suggestion && (
            <section className="o-card" aria-label="Suggestion">
              <h3 className="o-card__title">What would help</h3>
              <p className="o-card__text o-suggest">
                <Lightbulb size={14} aria-hidden="true" /> {item.suggestion}
              </p>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="o-card" aria-label="Shared">
            <h3 className="o-card__title">What both touched</h3>
            <ul className="o-artifacts">
              {item.artifacts.map((a) => {
                const Icon = ARTIFACT_ICONS[a.type];
                return (
                  <li key={a.value}>
                    <Icon size={14} aria-hidden="true" />
                    <span className={a.type === "task" ? undefined : "o-mono"}>{a.value}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="o-card" aria-label="What each side recorded">
            <h3 className="o-card__title">What each side recorded</h3>
            <ul className="o-quotes">
              {item.evidence.map((e) => {
                const side = item.sides.find((s) => s.id === e.sessionId)!;
                return (
                  <li key={e.sessionId}>
                    {side.person && <Initials name={side.person.name} />}
                    <span>
                      <span className="o-quotes__text">“{e.text}”</span>
                      <span className="o-activity__meta">
                        {side.person?.name.split(" ")[0]}'s {side.agent} · {ago(e.ts, fixtureClock)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="o-note">
            A shared file or task is a lead, not proof of wasted work – the two sides above are what the judgement rests on.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------- The Overlaps page's side panel while nothing is picked ---------- */

const CAT_COLORS: Record<OverlapCategory, string> = { attention: "#e8a200", waste: "#d9738f", coordinated: "#3fb950" };
const ORDER: OverlapCategory[] = ["attention", "waste", "coordinated"];

/**
 * The period's overlaps at a glance – the same frame as the week panel elsewhere (sections, icons,
 * chart, rows), filled with what this page is about: how many overlaps of which kind, what they
 * cost in tokens spent twice, and the latest ones.
 */
export function OverlapsWeekPanel({ data, onPick }: { data: Overview; onPick: (p: Pick) => void }) {
  const [by, setBy] = useState<"kind" | "people" | "initiative">("kind");
  const list = data.overlaps;
  if (!list.length)
    return (
      <div className="o-pane__empty o-week__empty">
        <p>No overlaps in this period.</p>
      </div>
    );
  const people = [...new Map(list.flatMap((o) => o.sides.flatMap((s) => (s.person ? [[s.person.id, s.person]] : [])))).values()];
  const twice = list.reduce((a, o) => a + (o.duplicateTokens ?? 0), 0);
  const talked = list.filter((o) => o.communication === "observed").length;
  const count = <K extends string>(key: (o: Overlap) => K) => {
    const m = new Map<K, number>();
    for (const o of list) m.set(key(o), (m.get(key(o)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const rows: { label: string; n: number; lead: ReactNode }[] =
    by === "kind"
      ? count((o) => o.kind).map(([k, n]) => {
          const Icon = KIND_ICONS[k];
          return { label: list.find((o) => o.kind === k)!.kindLabel, n, lead: <Icon size={14} aria-hidden="true" className="o-lead-icon" /> };
        })
      : by === "people"
        ? people
            .map((p) => ({ label: p.name, n: list.filter((o) => o.sides.some((s) => s.person?.id === p.id)).length, lead: <Initials name={p.name} /> as ReactNode }))
            .sort((a, b) => b.n - a.n)
        : count((o) => o.initiative ?? "No initiative").map(([name, n]) => ({ label: name, n, lead: <FolderOpen size={14} aria-hidden="true" className="o-lead-icon" /> }));

  return (
    <div className="o-week">
      <section className="o-card" aria-label="Properties">
        <h3 className="o-card__title">Properties</h3>
        <dl className="o-props">
          <dt>Period</dt>
          <dd>
            <CalendarDays size={14} aria-hidden="true" /> {data.period.label}
          </dd>
          <dt>Overlaps</dt>
          <dd className="o-props__stack">
            {ORDER.map((c) => {
              const n = list.filter((o) => o.category === c).length;
              return n ? (
                <span key={c}>
                  <span className="o-cat__dot o-lead-dot" data-cat={c} aria-hidden="true" /> {n} {CATEGORY_LABELS[c].toLowerCase()}
                </span>
              ) : null;
            })}
          </dd>
          <dt>People</dt>
          <dd className="o-props__stack">
            {people.map((p) => (
              <span key={p.id}>
                <Initials name={p.name} />
                {p.name}
              </span>
            ))}
          </dd>
          <dt>Spent twice</dt>
          <dd>
            <Coins size={14} aria-hidden="true" /> ~{formatTokens(twice)} tokens
          </dd>
          <dt>Talked</dt>
          <dd>
            <MessagesSquare size={14} aria-hidden="true" /> {talked} of {list.length} talked it through
          </dd>
        </dl>
      </section>

      <section className="o-card" aria-label="Tokens spent twice">
        <h3 className="o-card__title">Spent twice</h3>
        <CumulativeChart
          label="tokens spent twice, building up over the period"
          series={(["attention", "waste"] as const).map((c) => ({
            id: `ov-${c}`,
            name: CATEGORY_LABELS[c],
            short: c === "attention" ? "Worth a look" : "Done twice",
            color: CAT_COLORS[c],
            events: list.filter((o) => o.category === c && o.duplicateTokens).map((o) => ({ t: Date.parse(o.detectedAt), n: o.duplicateTokens! })),
          }))}
        />
        <div className="o-seg" role="tablist" aria-label="Break down by">
          {(["kind", "people", "initiative"] as const).map((d) => (
            <button key={d} type="button" role="tab" data-slot="o-seg" aria-selected={by === d} onClick={() => setBy(d)}>
              {d === "kind" ? "Kind" : d === "people" ? "People" : "Initiative"}
            </button>
          ))}
        </div>
        <ul className="o-breakdown">
          {rows.map((r) => (
            <li key={r.label}>
              {r.lead}
              <span className="o-breakdown__label">{r.label}</span>
              <span className="o2-num">{r.n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="o-card" aria-label="Recently detected">
        <h3 className="o-card__title">Recently detected</h3>
        <ul className="o-activity">
          {[...list]
            .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
            .slice(0, 5)
            .map((o) => (
              <li key={o.id}>
                <button type="button" data-slot="o-activity" className="o-activity__row ov-recent" onClick={() => onPick({ kind: "overlap", id: o.id })}>
                  <span className="o-cat__dot" data-cat={o.category} aria-hidden="true" />
                  <span className="o-activity__text">
                    <span className="o-activity__title">{o.title}</span>
                    <span className="o-activity__meta">
                      {o.kindLabel} · {ago(o.detectedAt, fixtureClock)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
