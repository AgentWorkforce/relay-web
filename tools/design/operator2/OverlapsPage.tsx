// Overlaps: where two agents' work touched the same thing, most urgent first – one plain list (the
// matrix and pairs views are gone; they didn't scale past a few people). A row opens the overlap's own page.
import { GitCompareArrows, MessagesSquare, MessageSquareOff, MessageSquareDashed } from "lucide-react";
import { fixtureClock } from "../scenarios";
import { ago, formatTokens, type Overview } from "../operator/model";
import { CategoryTag, KindLabel } from "../operator/OverlapPanel";
import type { Overlap } from "../operator/overlaps";
import { Initials } from "../operator/WeekPanel";
import type { Go } from "./App";
import { formatUSD } from "./cost";
import { PageHead } from "./PageHead";

const ORDER = { waste: 0, attention: 1, coordinated: 2 } as const;
/** Spent twice in dollars – the same blended estimate as elsewhere (≈ $5 per million tokens) */
export const twiceUSD = (o: Overlap) => (o.duplicateTokens === null ? null : (o.duplicateTokens / 1_000_000) * 5);

export function Talked({ o }: { o: Overlap }) {
  const [Icon, label] =
    o.communication === "observed"
      ? [MessagesSquare, "Talked it through"]
      : o.communication === "not_observed"
        ? [MessageSquareOff, "Didn't talk"]
        : [MessageSquareDashed, "Not known if they talked"];
  return (
    <span className="v2-talked" data-talked={o.communication}>
      <Icon size={14} aria-hidden="true" /> {label}
    </span>
  );
}

export function OverlapsPage({ data, go }: { data: Overview; go: Go }) {
  const list = [...data.overlaps].sort((a, b) => ORDER[a.category] - ORDER[b.category] || Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
  // One definition everywhere: everything that isn't coordinated needs attention – the sidebar shows the same number
  const open = list.filter((o) => o.category !== "coordinated").length;
  const twice = list.reduce((a, o) => a + (o.duplicateTokens ?? 0), 0);
  return (
    <>
      <PageHead title="Overlaps" sub="Where two agents touched the same work – and whether the people behind them talked." />

      {list.length === 0 && (
        <div className="v2-empty">
          <GitCompareArrows size={20} aria-hidden="true" />
          <b>No overlaps</b>
          <span>Nobody's agents ran into each other's work in this period.</span>
        </div>
      )}
      {list.length > 0 && (
        <section className="v2-section" aria-label="Overlaps">
          {/* The first entry: all overlaps together */}
          <div className="v2-overlaps__summary">
            <span>
              <b>All {list.length}</b> {list.length === 1 ? "overlap" : "overlaps"}
            </span>
            <span>{open ? `${open} need${open === 1 ? "s" : ""} attention` : "All coordinated"}</span>
            {twice > 0 && (
              <span>
                ~{formatTokens(twice)} tokens · {formatUSD((twice / 1_000_000) * 5)} est. spent twice
              </span>
            )}
            <span className="o2-muted">{data.period.label}</span>
          </div>
          <ul className="v2-overlaps">
            {list.map((o) => (
              <li key={o.id}>
                <button type="button" data-slot="v2-row" className="v2-overlap" data-done={o.category === "coordinated" || undefined} onClick={() => go({ page: "overlap", id: o.id })}>
                  <span className="v2-overlap__top">
                    <CategoryTag category={o.category} />
                    <span className="o2-muted">{ago(o.detectedAt, fixtureClock)}</span>
                  </span>
                  <span className="v2-overlap__title">{o.title}</span>
                  <span className="v2-overlap__meta">
                    <span className="v2-inline">
                      {[...new Map(o.sides.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()].map((p) => (
                        <Initials key={p.id} name={p.name} />
                      ))}
                      {[...new Set(o.sides.map((s) => s.person?.name.split(" ")[0] ?? "Unknown"))].join(" & ")}
                    </span>
                    <KindLabel item={o} />
                    {o.initiative && <span className="o2-muted">{o.initiative}</span>}
                    <Talked o={o} />
                    {o.duplicateTokens !== null && (
                      <span className="o2-muted">
                        ~{formatTokens(o.duplicateTokens)} tokens twice · {formatUSD(twiceUSD(o))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
