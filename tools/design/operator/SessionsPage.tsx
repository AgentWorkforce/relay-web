// Dashboard → Sessions: every session across machines and harnesses, as a list (find and open one)
// or as a timeline (when and where agents ran). Both views show the same sessions; the toggle is kept
// in the URL (?view=list|timeline). Team usage and each person live on the People page.
import { useState } from "react";
import { GanttChart, List } from "lucide-react";
import type { ScenarioId } from "../scenarios";
import { HomeShell } from "./HomeShell";
import { ListView } from "./HomeV1";
import { TimelineView } from "./HomeV3";
import type { Overview } from "./model";

type View = "list" | "timeline";
const VIEWS = [
  { id: "list", label: "List", icon: List },
  { id: "timeline", label: "Timeline", icon: GanttChart },
] as const;

const viewFrom = (value: string | null): View => (value === "timeline" ? "timeline" : "list");
const periodWord = (data: Overview) => (data.period.days === 1 ? "today" : data.period.days === 7 ? "this week" : "this month");

function Header({ data, view, onView }: { data: Overview; view: View; onView: (v: View) => void }) {
  const sessions = data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions);
  const running = sessions.filter((s) => s.status === "active").length;
  const people = new Set(sessions.flatMap((s) => (s.person ? [s.person.id] : []))).size;
  return (
    <header className="ss-head">
      <div className="o2-hero">
        <p className="o2-eyebrow">
          {data.org} · {data.workspace}
        </p>
        <h2 className="ss-title">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"} {periodWord(data)} · {running ? `${running} running now` : "nothing running"} ·{" "}
          {people} {people === 1 ? "person" : "people"}
        </h2>
      </div>
      <div className="o2-seg ss-views" role="tablist" aria-label="Show sessions as">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button key={v.id} type="button" role="tab" data-slot="o2-seg" aria-selected={view === v.id} onClick={() => onView(v.id)}>
              <Icon size={14} aria-hidden="true" />
              {v.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

export function SessionsPage({ scenario }: { scenario: ScenarioId }) {
  const [view, setViewState] = useState<View>(() => viewFrom(new URLSearchParams(location.search).get("view")));
  const setView = (next: View) => {
    setViewState(next);
    const url = new URL(location.href);
    url.searchParams.set("view", next);
    history.replaceState(null, "", url);
  };
  return (
    <HomeShell scenario={scenario} page="sessions" className="ss-page">
      {(data, pick, onPick) => (
        <>
          <Header data={data} view={view} onView={setView} />
          {view === "list" ? (
            <div className="hm1 ss-view">
              <ListView data={data} pick={pick} onPick={onPick} />
            </div>
          ) : (
            <div className="hm3 ss-view">
              <TimelineView data={data} selected={pick?.kind === "session" ? pick.id : null} onPick={onPick} />
            </div>
          )}
        </>
      )}
    </HomeShell>
  );
}
