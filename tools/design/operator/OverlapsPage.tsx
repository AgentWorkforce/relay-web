// Overlaps page – where two agents' work touches the same thing, and whether that's fine (they
// coordinated), effort spent twice, or worth a look. Answers the operator's third question: where is
// effort getting stuck or repeated? Three versions:
//   v1 List   – grouped by what to make of it, like the Overview's list (Linear-style rows)
//   v2 Pairs  – each overlap as its two sides, with what they share in between
//   v3 Matrix – who overlaps with whom, then the overlaps of the picked pair
import { Fragment, useState, type ReactNode } from "react";
import { FileText, GitBranch, ListTodo } from "lucide-react";
import { fixtureClock, type ScenarioId } from "../scenarios";
import { Frame } from "./Frame";
import { ago, formatTokens, type Overview, type Person, type SessionItem } from "./model";
import { Avatars, type Pick } from "./OperatorV1";
import { CategoryTag, KindLabel, OverlapsWeekPanel } from "./OverlapPanel";
import { CATEGORY_LABELS, type Overlap, type OverlapCategory } from "./overlaps";
import { HarnessLogo, InitiativeDetail, Initials, SessionDetail } from "./WeekPanel";

const ORDER: OverlapCategory[] = ["attention", "waste", "coordinated"];
const HINTS: Record<OverlapCategory, string> = {
  attention: "The two sides didn't talk and one may be working from the wrong picture",
  waste: "The same work was done twice – the tokens went in twice",
  coordinated: "Same area, but the agents talked it through – nothing to do",
};

function Shell({ scenario, className, children }: { scenario: ScenarioId; className: string; children: (data: Overview, pick: Pick | null, onPick: (p: Pick) => void) => ReactNode }) {
  return (
    <Frame
      scenario={scenario}
      page="overlaps"
      title="Overlaps"
      className={className}
      // The panel's frame is shared; while nothing is picked it summarises this page: the period's overlaps
      idle={{ title: "This week", open: true, render: (data, onPick) => <OverlapsWeekPanel data={data} onPick={onPick} /> }}
      detail={{
        initiative: (item, tab, onSession) => <InitiativeDetail item={item} tab={tab} onSession={onSession} />,
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {children}
    </Frame>
  );
}

/** The page's opening: one sentence on what matters, the numbers under it */
function Lede({ data }: { data: Overview }) {
  const attention = data.overlaps.filter((o) => o.category === "attention").length;
  const waste = data.overlaps.filter((o) => o.category === "waste");
  const twice = waste.concat(data.overlaps.filter((o) => o.category === "attention")).reduce((a, o) => a + (o.duplicateTokens ?? 0), 0);
  const headline =
    data.overlaps.length === 0
      ? "No overlaps in this period."
      : attention + waste.length === 0
        ? "Agents overlapped, but always talked it through."
        : `${attention ? `${attention} ${attention === 1 ? "overlap is" : "overlaps are"} worth a look` : `${waste.length} ${waste.length === 1 ? "piece" : "pieces"} of work done twice`}${twice ? ` – about ${formatTokens(twice)} tokens went in twice` : ""}.`;
  return (
    <section className="o2-hero" aria-label="Summary">
      <p className="o2-eyebrow">
        {data.org} · {data.workspace}
      </p>
      <h2 className="o2-headline">{headline}</h2>
      <p className="o2-sub">
        {data.overlaps.length} overlaps across {new Set(data.overlaps.map((o) => o.initiative)).size} initiatives ·{" "}
        {data.overlaps.filter((o) => o.category === "coordinated").length} coordinated
      </p>
    </section>
  );
}

const peopleOf = (o: Overlap): Person[] => [...new Map(o.sides.flatMap((s) => (s.person ? [[s.person.id, s.person]] : []))).values()];

function Empty({ data }: { data: Overview }) {
  return (
    <div className="o2-empty">
      <h2>{data.analysis === "empty" ? "No recorded work yet" : "No overlaps in this period"}</h2>
      <p>When two agents work on the same files, branches or tasks, it shows up here – with whether they talked it through.</p>
    </div>
  );
}

/* ---------- v1 List ---------- */

export function OverlapsV1({ scenario }: { scenario: ScenarioId }) {
  return (
    <Shell scenario={scenario} className="o2">
      {(data, pick, onPick) =>
        data.overlaps.length === 0 ? (
          <Empty data={data} />
        ) : (
          <>
            <Lede data={data} />
            {ORDER.map((cat) => {
              const items = data.overlaps.filter((o) => o.category === cat);
              if (!items.length) return null;
              return (
                <section key={cat} className="o2-section ov-group" aria-label={CATEGORY_LABELS[cat]}>
                  {/* A tinted group header, on the same left edge as the rows – like Linear's grouped lists */}
                  <header className="ov-group__head">
                    <h2 className="ov-group__title">
                      <CategoryTag category={cat} />
                      <span className="ov-group__count">{items.length}</span>
                    </h2>
                    <p className="ov-group__hint">{HINTS[cat]}</p>
                  </header>
                  <div className="o2-table ov-table" role="list">
                    <div className="o2-table__head" aria-hidden="true">
                      <span>Overlap</span>
                      <span>Kind</span>
                      <span>People</span>
                      <span className="o2-num">Spent twice</span>
                      <span className="o2-num">Detected</span>
                    </div>
                    {items.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        role="listitem"
                        data-slot="o2-row"
                        className="o2-row"
                        aria-pressed={pick?.kind === "overlap" && pick.id === o.id}
                        onClick={() => onPick({ kind: "overlap", id: o.id })}
                      >
                        <span className="o2-row__main">
                          <span className="o2-row__name">{o.title}</span>
                          <span className="o2-row__update">{o.initiative}</span>
                        </span>
                        <span className="o2-muted ov-kind-cell">
                          <KindLabel item={o} />
                        </span>
                        <Avatars people={peopleOf(o)} />
                        <span className={`o2-num${o.duplicateTokens === null ? " o2-muted" : ""}`}>{o.duplicateTokens === null ? "–" : `~${formatTokens(o.duplicateTokens)}`}</span>
                        <span className="o2-num o2-muted">{ago(o.detectedAt, fixtureClock)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            <p className="o2-foot">Overlaps are proposed findings in the shape of the coordination contract (coordination-overlaps/1) – a shared file or task is a lead, not proof.</p>
          </>
        )
      }
    </Shell>
  );
}

/* ---------- v2 Pairs ---------- */

function Side({ s }: { s: SessionItem }) {
  return (
    <span className="ov-side">
      <span className="ov-side__who">
        {s.person && <Initials name={s.person.name} />}
        {s.person?.name.split(" ")[0]}'s
        <HarnessLogo source={s.source} />
        {s.agent}
      </span>
      <span className="ov-side__what">{s.title}</span>
    </span>
  );
}
const ARTIFACT_ICONS = { file: FileText, branch: GitBranch, task: ListTodo } as const;

export function OverlapsV2({ scenario }: { scenario: ScenarioId }) {
  return (
    <Shell scenario={scenario} className="o2">
      {(data, pick, onPick) =>
        data.overlaps.length === 0 ? (
          <Empty data={data} />
        ) : (
          <>
            <Lede data={data} />
            <section className="o2-section" aria-label="Overlaps">
              <ul className="ov-pairs">
                {[...data.overlaps]
                  .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))
                  .map((o) => {
                    const shared = o.artifacts[0]!;
                    const Icon = ARTIFACT_ICONS[shared.type];
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          data-slot="ov-pair"
                          className="ov-pair"
                          aria-pressed={pick?.kind === "overlap" && pick.id === o.id}
                          onClick={() => onPick({ kind: "overlap", id: o.id })}
                        >
                          <span className="ov-pair__top">
                            <CategoryTag category={o.category} />
                            <span className="ov-pair__title">{o.title}</span>
                            <span className="o2-muted o2-small">{ago(o.detectedAt, fixtureClock)}</span>
                          </span>
                          <span className="ov-pair__lane">
                            <Side s={o.sides[0]} />
                            <span className="ov-pair__link" data-cat={o.category}>
                              <span className="ov-pair__shared">
                                <Icon size={12} aria-hidden="true" />
                                <span>{shared.value}</span>
                              </span>
                              <span className="ov-pair__talk">{o.communication === "observed" ? "talked it through" : o.communication === "not_observed" ? "didn't talk" : "unknown"}</span>
                            </span>
                            <Side s={o.sides[1]} />
                          </span>
                          {o.duplicateTokens !== null && <span className="ov-pair__cost">~{formatTokens(o.duplicateTokens)} tokens spent twice</span>}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </section>
          </>
        )
      }
    </Shell>
  );
}

/* ---------- v3 Matrix ---------- */

export function OverlapsV3({ scenario }: { scenario: ScenarioId }) {
  const [cell, setCell] = useState<string | null>(null);
  return (
    <Shell scenario={scenario} className="o2">
      {(data, pick, onPick) => {
        if (data.overlaps.length === 0) return <Empty data={data} />;
        const people = [...new Map(data.overlaps.flatMap((o) => peopleOf(o).map((p) => [p.id, p] as const))).values()].sort((a, b) => a.name.localeCompare(b.name));
        const pairKey = (a: string, b: string) => [a, b].sort().join("|");
        const keyOf = (o: Overlap) => {
          const ids = o.sides.map((s) => s.person?.id ?? "?");
          return pairKey(ids[0]!, ids[1]!);
        };
        const worst = (list: Overlap[]) => ORDER.find((c) => list.some((o) => o.category === c)) ?? null;
        const shown = cell ? data.overlaps.filter((o) => keyOf(o) === cell) : data.overlaps;
        return (
          <>
            <Lede data={data} />
            <section className="o2-section" aria-label="Who overlaps with whom">
              <div className="ov-head">
                <h2 className="o2-h">Who overlaps with whom</h2>
                <p className="o2-muted">Each square is a pair of people; its color is the most pressing overlap between them. Pick one to see its overlaps.</p>
              </div>
              <div className="ov-matrix" style={{ gridTemplateColumns: `120px repeat(${people.length}, minmax(0, 1fr))` }}>
                <span />
                {people.map((p) => (
                  <span key={p.id} className="ov-matrix__col">
                    <Initials name={p.name} /> {p.name.split(" ")[0]}
                  </span>
                ))}
                {people.map((row) => (
                  <Fragment key={row.id}>
                    <span className="ov-matrix__row">
                      <Initials name={row.name} /> {row.name}
                    </span>
                    {people.map((col) => {
                      const k = pairKey(row.id, col.id);
                      const list = data.overlaps.filter((o) => keyOf(o) === k);
                      const w = worst(list);
                      return (
                        <button
                          key={`${row.id}-${col.id}`}
                          type="button"
                          data-slot="ov-cell"
                          className="ov-cell"
                          data-cat={w ?? undefined}
                          aria-pressed={cell === k}
                          disabled={!list.length}
                          title={list.length ? `${row.name} & ${col.name}: ${list.length} overlap${list.length === 1 ? "" : "s"}` : `${row.name} & ${col.name}: none`}
                          onClick={() => {
                            if (cell === k) return setCell(null);
                            setCell(k);
                            // Open the most pressing overlap of the pair right away; the list below shows the rest
                            const first = [...list].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))[0];
                            if (first && !(pick?.kind === "overlap" && pick.id === first.id)) onPick({ kind: "overlap", id: first.id });
                          }}
                        >
                          {list.length || ""}
                        </button>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
              <div className="ov-legend">
                {ORDER.map((c) => (
                  <CategoryTag key={c} category={c} />
                ))}
              </div>
            </section>
            <section className="o2-section" aria-label="Overlaps">
              <h2 className="o2-h">{cell ? `${shown.length} ${shown.length === 1 ? "overlap" : "overlaps"} between them` : "All overlaps"}</h2>
              <ul className="o-activity ov-list">
                {shown.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      data-slot="o-activity"
                      className="o-activity__row ov-list__row"
                      aria-pressed={pick?.kind === "overlap" && pick.id === o.id}
                      onClick={() => onPick({ kind: "overlap", id: o.id })}
                    >
                      <span className="o-cat__dot" data-cat={o.category} aria-hidden="true" />
                      <span className="o-activity__text">
                        <span className="o-activity__title">{o.title}</span>
                        <span className="o-activity__meta">
                          {o.kindLabel} · {o.initiative} · {ago(o.detectedAt, fixtureClock)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        );
      }}
    </Shell>
  );
}
