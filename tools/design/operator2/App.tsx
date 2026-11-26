// Operator view v2 – the iteration on Khaliq's feedback of 25 Nov: simpler, less dense, no nesting.
// Two pages (Tasks, Overlaps), each with a detail page of its own instead of a side panel; no tabs,
// no design versions, no second rail. Every page has its own URL, so a task or an overlap can be
// linked to directly (?page=task&id=…), and the browser's back button works.
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ChevronRight, GitCompareArrows, ListTodo, RefreshCw } from "lucide-react";
import { AppShellFlat } from "../../../src/affectui/screens/app-shell-flat/component";
import { DropdownMenu } from "../../../src/affectui/registry/dropdown-menu/component.clean";
import type { MenuItem, ShellNavItem } from "../../../src/affectui/screens/app-shell/component";
import { ComputerIcon, Moon02Icon, PaintBoardIcon, Sun03Icon } from "../../../src/shell/shell-icons";
import { setThemePreference, themePreference } from "../../../src/shell/theme";
import type { ScenarioId } from "../scenarios";
import { overview, PERIODS, periodFrom, type Overview, type Period } from "../operator/model";
import { TasksPage } from "./TasksPage";
import { TaskPage } from "./TaskPage";
import { OverlapsPage } from "./OverlapsPage";
import { OverlapPage } from "./OverlapPage";
import { densityFrom, emptyTask, withDensity, type Density } from "./data";
import { DataSwitch } from "./DataSwitch";
import { registerArtifacts } from "./outcomes";
import { VIEW_PARAMS } from "./urlState";
import { TaskSplit } from "./TaskSplit";
import { SessionPage } from "./SessionPage";
import { SessionChat } from "./SessionChat";

export type Route = { page: "tasks" } | { page: "task"; id: string } | { page: "session"; id: string } | { page: "overlaps" } | { page: "overlap"; id: string };
export type Go = (to: Route) => void;

function routeFrom(search: string): Route {
  const p = new URLSearchParams(search);
  const id = p.get("id");
  switch (p.get("page")) {
    case "task":
      return id ? { page: "task", id } : { page: "tasks" };
    case "session":
      return id ? { page: "session", id } : { page: "tasks" };
    case "overlaps":
      return { page: "overlaps" };
    case "overlap":
      return id ? { page: "overlap", id } : { page: "overlaps" };
    default:
      return { page: "tasks" };
  }
}
function urlOf(to: Route) {
  const url = new URL(location.href);
  url.searchParams.set("page", to.page);
  if ("id" in to) url.searchParams.set("id", to.id);
  else url.searchParams.delete("id");
  url.searchParams.delete("v");
  // A page's view state (tab, open artifact, picked day …) belongs to that page only
  for (const key of VIEW_PARAMS) url.searchParams.delete(key);
  return url;
}

/** "Updated 2m ago" and a button to fetch again (here: recompute the fixtures) */
function Freshness({ at, onRefresh }: { at: number; onRefresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    const auto = setInterval(onRefresh, 5 * 60_000);
    return () => {
      clearInterval(t);
      clearInterval(auto);
    };
  }, [onRefresh]);
  const mins = Math.floor((Date.now() - at) / 60_000);
  return (
    <span className="v2-fresh">
      Updated {mins < 1 ? "just now" : `${mins}m ago`}
      <button type="button" data-slot="v2-fresh" className="v2-icon-btn" aria-label="Refresh" title="Refresh" onClick={onRefresh}>
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

export function OperatorApp2({ scenario }: { scenario: ScenarioId }) {
  const [route, setRoute] = useState<Route>(() => routeFrom(location.search));
  useEffect(() => {
    const back = () => setRoute(routeFrom(location.search));
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);
  const go = useCallback<Go>((to) => {
    history.pushState(null, "", urlOf(to));
    setRoute(to);
    document.querySelector(".flat-shell__content")?.scrollTo({ top: 0 });
  }, []);

  const [period, setPeriodState] = useState<Period>(() => periodFrom(new URLSearchParams(location.search).get("period")));
  const setPeriod = (next: Period) => {
    setPeriodState(next);
    const url = new URL(location.href);
    url.searchParams.set("period", next.id);
    history.replaceState(null, "", url);
  };
  const [refreshed, setRefreshed] = useState(() => Date.now());
  const refresh = useCallback(() => setRefreshed(Date.now()), []);
  // The task page's layout: 1 = one column, 2 = summary left and tabs right (?layout=1|2, remembered)
  const [taskLayout, setTaskLayoutState] = useState<number>(() => {
    const fromUrl = Number(new URLSearchParams(location.search).get("layout"));
    if (fromUrl === 1 || fromUrl === 2) return fromUrl;
    try {
      return Number(localStorage.getItem("agent-relay.workbench.task-layout")) === 2 ? 2 : 1;
    } catch {
      return 1;
    }
  });
  const setTaskLayout = (next: number) => {
    setTaskLayoutState(next);
    try {
      localStorage.setItem("agent-relay.workbench.task-layout", String(next));
    } catch {
      // Storage blocked – the URL still has it
    }
    const url = new URL(location.href);
    url.searchParams.set("layout", String(next));
    history.replaceState(null, "", url);
  };
  // The session page's layout: 1 = facts left and tabs right, 2 = the conversation as a chat (?slayout=1|2, remembered)
  const [sessionLayout, setSessionLayoutState] = useState<number>(() => {
    const fromUrl = Number(new URLSearchParams(location.search).get("slayout"));
    if (fromUrl === 1 || fromUrl === 2) return fromUrl;
    try {
      return Number(localStorage.getItem("agent-relay.workbench.session-layout")) === 1 ? 1 : 2;
    } catch {
      return 2;
    }
  });
  const setSessionLayout = (next: number) => {
    setSessionLayoutState(next);
    try {
      localStorage.setItem("agent-relay.workbench.session-layout", String(next));
    } catch {
      // Storage blocked – the URL still has it
    }
    const url = new URL(location.href);
    url.searchParams.set("slayout", String(next));
    history.replaceState(null, "", url);
  };
  // None / a few / many entries – the review switch at the bottom centre (?data=…, remembered)
  const [density, setDensityState] = useState<Density>(densityFrom);
  const setDensity = (next: Density) => {
    setDensityState(next);
    try {
      localStorage.setItem("agent-relay.workbench.data", next);
    } catch {
      // Storage blocked – the URL still has it
    }
    const url = new URL(location.href);
    url.searchParams.set("data", next);
    history.replaceState(null, "", url);
  };
  // "None" on a task's page keeps the task and empties it, so its empty states show; elsewhere it empties the lists
  const taskId = route.page === "task" ? route.id : null;
  const data: Overview = useMemo(() => {
    const base = overview(scenario, period);
    // Every task's artifacts are worked out once per data change, so all pages agree on them
    return registerArtifacts(density === "none" && taskId && base.initiatives.some((i) => i.id === taskId) ? emptyTask(base, taskId) : withDensity(base, density));
  }, [scenario, period, refreshed, density, taskId]);
  const [, setTheme] = useState(themePreference);

  const openOverlaps = data.overlaps.filter((o) => o.category !== "coordinated").length;
  const nav: ShellNavItem[] = [
    { label: "Tasks", icon: ListTodo },
    { label: "Overlaps", icon: GitCompareArrows, count: openOverlaps },
  ];
  const accountItems: MenuItem[] = [
    {
      label: "Appearance",
      icon: PaintBoardIcon,
      submenu: (["light", "dark", "system"] as const).map((value) => ({
        label: value === "system" ? "System" : value === "light" ? "Light" : "Dark",
        icon: value === "light" ? Sun03Icon : value === "dark" ? Moon02Icon : ComputerIcon,
        checked: themePreference() === value,
        onSelect: () => {
          setThemePreference(value);
          setTheme(value);
        },
      })),
    },
  ];
  const active = route.page === "overlaps" || route.page === "overlap" ? "Overlaps" : "Tasks";
  // Where you are, as in Interfere's header: the section, then each page on the way here – each step back
  // a click away, so the pages themselves need no back button
  const crumbs: { label: string; to?: Route }[] = [];
  if (route.page === "overlaps" || route.page === "overlap") {
    crumbs.push({ label: "Overlaps", to: { page: "overlaps" } });
    const o = route.page === "overlap" ? data.overlaps.find((x) => x.id === route.id) : null;
    if (o) crumbs.push({ label: o.title });
  } else {
    crumbs.push({ label: "Tasks", to: { page: "tasks" } });
    const task =
      route.page === "task"
        ? data.initiatives.find((i) => i.id === route.id)
        : route.page === "session"
          ? data.initiatives.find((i) => i.sessions.some((x) => x.id === route.id))
          : null;
    if (task) crumbs.push({ label: task.name, to: { page: "task", id: task.id } });
    const session = route.page === "session" ? task?.sessions.find((x) => x.id === route.id) : null;
    if (session) crumbs.push({ label: session.title });
  }
  // The last step is the page you're on – not a link
  crumbs[crumbs.length - 1] = { label: crumbs.at(-1)!.label };

  let page: ReactNode;
  if (data.analysis === "empty")
    page = (
      <div className="o2-empty">
        <h2>No recorded work yet</h2>
        <p>Once agents record work, this page shows what the team is moving forward.</p>
      </div>
    );
  else if (route.page === "task") page = taskLayout === 2 ? <TaskSplit data={data} id={route.id} go={go} /> : <TaskPage data={data} id={route.id} go={go} />;
  else if (route.page === "session") page = sessionLayout === 2 ? <SessionChat data={data} id={route.id} /> : <SessionPage data={data} id={route.id} go={go} />;
  else if (route.page === "overlaps") page = <OverlapsPage data={data} go={go} />;
  else if (route.page === "overlap") page = <OverlapPage data={data} id={route.id} go={go} />;
  else page = <TasksPage data={data} go={go} />;

  return (
    <div className="v2-frame flat-shell">
      <AppShellFlat
        active={active}
        onNavigate={(label) => {
          if (label === "Tasks") return go({ page: "tasks" });
          if (label === "Overlaps") go({ page: "overlaps" });
        }}
        workspace={data.org}
        workspaceMeta={data.workspace}
        user={{ name: "Ana Silva", email: "ana@example.test" }}
        nav={nav}
        // Only the two pages – no list of tasks (it doesn't scale) and none of the shell's sample groups
        groups={[]}
        projects={[]}
        sideCards={false}
        accountItems={accountItems}
        workspaceItems={[]}
        commandGroups={[{ id: "tasks", label: "Tasks", commands: data.initiatives.map((i) => ({ id: i.id, label: i.name })) }]}
        onCommand={(id) => go({ page: "task", id })}
        commandPlaceholder="Jump to a task…"
        header={{
          title: (
            <nav className="v2-crumbs" aria-label="You are here">
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  {i > 0 && <ChevronRight size={14} aria-hidden="true" className="v2-crumbs__sep" />}
                  {c.to ? (
                    <button type="button" data-slot="v2-crumb" className="v2-crumbs__link" onClick={() => go(c.to!)}>
                      {c.label}
                    </button>
                  ) : (
                    <h1 className="o2-title v2-crumbs__here">{c.label}</h1>
                  )}
                </Fragment>
              ))}
            </nav>
          ),
          actions: (
            <span className="o-head-actions">
              <Freshness at={refreshed} onRefresh={refresh} />
              <DropdownMenu
                align="end"
                items={PERIODS.map((p) => ({ label: p.label, checked: p.id === period.id, onSelect: () => setPeriod(p) }))}
                trigger={({ toggle, triggerProps }) => (
                  <button type="button" data-slot="o-period" className="o-period" {...triggerProps} onClick={toggle}>
                    <CalendarDays size={14} aria-hidden="true" />
                    {period.label}
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                )}
              />
            </span>
          ),
        }}
      >
        <main className={`o2 v2 flat-shell__content${(route.page === "task" && taskLayout === 2) || (route.page === "session" && sessionLayout === 1) ? " v2--split" : ""}`}>{page}</main>
      </AppShellFlat>
      <DataSwitch value={density} onChange={setDensity} layout={
          route.page === "task"
            ? { count: 2, value: taskLayout, onChange: setTaskLayout }
            : route.page === "session"
              ? { count: 2, value: sessionLayout, onChange: setSessionLayout }
              : undefined
        } />
    </div>
  );
}
