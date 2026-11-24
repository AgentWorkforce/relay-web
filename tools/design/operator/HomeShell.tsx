// The team dashboard's frame (rail: Dashboard), shared by its two pages: Sessions (list or timeline)
// and People (team usage and each person). It is the working
// view for the people who run the agents and their lead: every session across machines and harnesses,
// who is working on what, and how the team uses Relay – the three parts of today's dashboard (session
// list, team usage, person drill-down) brought into one page. Sessions open in the right panel.
import type { ReactNode } from "react";
import type { ScenarioId } from "../scenarios";
import { Frame } from "./Frame";
import type { Overview } from "./model";
import type { Pick } from "./OperatorV1";
import { InitiativeDetail, SessionDetail } from "./WeekPanel";

export function HomeShell({
  scenario,
  page,
  className,
  idle,
  children,
}: {
  scenario: ScenarioId;
  /** Which page of the dashboard area this is – the sidebar marks it */
  page: "home" | "sessions" | "people";
  /** The page's own root class, next to the shared "o2 hm-page" */
  className?: string;
  /** What the right panel shows while nothing is picked (optional – without it the panel opens only for a session) */
  idle?: { title: string; render: (data: Overview, onPick: (p: Pick) => void) => ReactNode };
  children: (data: Overview, pick: Pick | null, onPick: (p: Pick) => void) => ReactNode;
}) {
  return (
    <Frame
      scenario={scenario}
      page={page}
      title={page === "home" ? "Overview" : page === "sessions" ? "Sessions" : "People"}
      className={`o2 hm-page${className ? ` ${className}` : ""}`}
      idle={idle}
      detail={{
        initiative: (item, tab, onSession) => <InitiativeDetail item={item} tab={tab} onSession={onSession} />,
        session: (item, tab) => <SessionDetail item={item} tab={tab} />,
      }}
    >
      {(data, pick, onPick) =>
        data.analysis === "empty" ? (
          <div className="o2-empty">
            <h2>No sessions yet</h2>
            <p>Once someone connects an agent and works with it, their sessions show up here.</p>
          </div>
        ) : (
          children(data, pick, onPick)
        )
      }
    </Frame>
  );
}
