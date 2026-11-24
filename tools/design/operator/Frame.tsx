// The dashboard frame every operator variant shares: App Shell Flat with the initiatives in the
// sidebar and the initiative / session detail in the right panel. A variant only renders its page.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShellFlat } from "../../../src/affectui/screens/app-shell-flat/component";
import type { CommandGroup } from "../../../src/affectui/registry/command-menu/component.clean";
import { DropdownMenu } from "../../../src/affectui/registry/dropdown-menu/component.clean";
import type { MenuItem, ShellNavItem } from "../../../src/affectui/screens/app-shell/component";
import {
  ComputerIcon,
  DashboardSquare01Icon,
  FolderOpenIcon,
  Moon02Icon,
  PaintBoardIcon,
  Sun03Icon,
} from "../../../src/shell/shell-icons";
import { AppWindow, BookOpen, Database, Gauge, Workflow } from "lucide-react";
import { setThemePreference, themePreference } from "../../../src/shell/theme";
import { LogoIcon } from "../../../src/shell/brand";
import type { ScenarioId } from "../scenarios";
import { overview, PERIODS, periodFrom, type Initiative, type Overview, type Period, type SessionItem } from "./model";
import { CalendarDays, ChevronDown, ChevronLeft, Coins, GitCompareArrows, LayoutGrid, MessagesSquare, Network, Users, MousePointerClick, PanelRight, RefreshCw } from "lucide-react";
import { OVERLAP_TABS, OverlapDetail } from "./OverlapPanel";
import { PERSON_TABS, PersonDetail, personOf } from "./PersonPanel";
import { openPage, PAGES, type Area, type PageId } from "./pages";
import { INITIATIVE_TABS, InitiativePanel, SESSION_TABS, SessionPanel, type Pick } from "./OperatorV1";

// The rail: the workbench's areas, one icon each. Dashboard (the team dashboard redesign) and Operator
// are served by this app; the others open in the workbench.
const AREAS = [
  { label: "Dashboard", hint: "The team dashboard – sessions, people, usage", icon: AppWindow, area: "dashboard", view: null },
  { label: "Operator", hint: "The overview for engineering leads", icon: Gauge, area: "operator", view: null },
  { label: "Pipeline sample", hint: "A computed analysis and its evidence", icon: Workflow, area: null, view: "Pipeline sample" },
  { label: "Data catalog", hint: "Every field, what it means and its limits", icon: Database, area: null, view: "Data catalog" },
] as const;
const GUIDE = { label: "Start here", hint: "The designer guide for this workbench", icon: BookOpen, view: "Start here" } as const;

export function openArea(scenario: ScenarioId, view: string) {
  const url = `/?${new URLSearchParams({ scenario, view })}`;
  // Inside the workbench's frame the whole workbench switches; on its own the page does
  (window.top ?? window).location.href = url;
}
/** Opens one of this app's areas (operator / dashboard) on its first page, keeping the period */
function goToArea(scenario: ScenarioId, area: Area) {
  const url = new URL(location.href);
  url.pathname = `/${area}/${scenario}/`;
  url.searchParams.delete("page");
  url.searchParams.delete("v");
  location.href = url.href;
}

/**
 * Whether the panel starts open: closed whenever a page opens – except right after switching design
 * versions, where it stays as it was (VariantSwitch notes that just before it reloads).
 */
const KEEP_PANEL = "agent-relay.operator.keep-panel";
function takePanelOpen() {
  try {
    const kept = sessionStorage.getItem(KEEP_PANEL);
    sessionStorage.removeItem(KEEP_PANEL);
    return kept === "1";
  } catch {
    return false;
  }
}
export function keepPanelForReload() {
  try {
    const open = document.querySelector(".ui-as-app")?.getAttribute("data-panel") === "open";
    sessionStorage.setItem(KEEP_PANEL, open ? "1" : "0");
  } catch {
    // Storage blocked – the next view just starts with the panel closed
  }
}

export function Frame({
  scenario,
  title,
  className,
  page = "overview",
  idle,
  detail,
  children,
}: {
  scenario: ScenarioId;
  /** Which of the operator pages this is – the wide sidebar marks it */
  page?: PageId;
  title: string;
  className: string;
  /** What the panel shows while nothing is picked – e.g. the week at a glance; open from the start if `open` */
  idle?: { title: string; open?: boolean; render: (data: Overview, onPick: (p: Pick) => void) => ReactNode };
  /** The variant's own detail views (in place of the shared ones); with an idle panel they get a back link to it */
  detail?: {
    initiative: (item: Initiative, tab: string, onSession: (id: string) => void) => ReactNode;
    session: (item: SessionItem, tab: string) => ReactNode;
  };
  children: (data: Overview, pick: Pick | null, onPick: (p: Pick) => void) => ReactNode;
}) {
  // The period shown – kept in the URL (?period=24h|7d|30d) so a shared link opens the same view
  const [period, setPeriodState] = useState<Period>(() => periodFrom(new URLSearchParams(location.search).get("period")));
  const setPeriod = (next: Period) => {
    setPeriodState(next);
    const url = new URL(location.href);
    url.searchParams.set("period", next.id);
    history.replaceState(null, "", url);
  };
  // When the numbers were last fetched; a refresh fetches again (here: recomputes the fixtures)
  const [refreshed, setRefreshed] = useState(() => Date.now());
  const refresh = useCallback(() => setRefreshed(Date.now()), []);
  const data = useMemo(() => overview(scenario, period), [scenario, period, refreshed]);
  const [panelOpenAtStart] = useState(takePanelOpen);
  const [pick, setPickState] = useState<Pick | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  // Something new in the panel starts on its first tab
  const setPick = (next: Pick | null) => {
    setPickState(next);
    setTab(null);
  };
  const [reveal, setReveal] = useState(0);
  const [hide, setHide] = useState(0);
  const [, setTheme] = useState(themePreference);
  const onPanelOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPickState(null);
      setTab(null);
    }
  }, []);
  const show = (next: Pick) => {
    if (pick && pick.kind === next.kind && pick.id === next.id) {
      setPick(null);
      setHide((n) => n + 1);
      return;
    }
    setPick(next);
    setReveal((n) => n + 1);
  };
  const initiative = (id: string) => data.initiatives.find((i) => i.id === id) ?? null;
  const sessions = [...data.initiatives.flatMap((i) => i.sessions), ...data.projects.flatMap((p) => p.sessions)];
  const picked = pick?.kind === "initiative" ? initiative(pick.id) : null;
  const pickedSession = pick?.kind === "session" ? (sessions.find((s) => s.id === pick.id) ?? null) : null;
  const overlap = (id: string) => data.overlaps.find((o) => o.id === id) ?? null;
  const pickedOverlap = pick?.kind === "overlap" ? overlap(pick.id) : null;
  // One step back: a session returns to what it was opened from (initiative or overlap), else to the idle panel
  const back = pick?.kind === "session" && pick.from ? initiative(pick.from) : null;
  const backOverlap = pick?.kind === "session" && pick.fromOverlap ? overlap(pick.fromOverlap) : null;
  // A person (dashboard area): their usage, projects and sessions; a session opened there leads back to them
  const pickedPerson = pick?.kind === "person" ? personOf(data, pick.id) : null;
  const backPerson = pick?.kind === "session" && pick.fromPerson ? personOf(data, pick.fromPerson) : null;

  const tabs: readonly string[] = picked
    ? INITIATIVE_TABS
    : pickedSession
      ? SESSION_TABS
      : pickedOverlap
        ? OVERLAP_TABS
        : pickedPerson
          ? PERSON_TABS
          : [idle ? period.title : "Details"];
  const currentTab = tab && tabs.includes(tab) ? tab : tabs[0]!;

  const pageLabel = PAGES.find((p) => p.id === page)!.label;
  const openOverlaps = data.overlaps.filter((o) => o.category !== "coordinated").length;
  const area = PAGES.find((p) => p.id === page)!.area;
  const nav: ShellNavItem[] =
    area === "operator"
      ? [
          { label: "Overview", icon: DashboardSquare01Icon },
          { label: "Overlaps", icon: GitCompareArrows, count: openOverlaps },
          { label: "Spend", icon: Coins },
          { label: "Map", icon: Network },
        ]
      : [
          { label: "Overview", icon: LayoutGrid },
          { label: "Sessions", icon: MessagesSquare },
          { label: "People", icon: Users },
        ];
  const groups =
    area === "operator" && data.initiatives.length
      ? [{ label: "Initiatives", items: data.initiatives.map((i) => ({ label: i.name, icon: FolderOpenIcon })) }]
      : [];
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
  const commandGroups: CommandGroup[] = [
    { id: "initiatives", label: "Initiatives", commands: data.initiatives.map((i) => ({ id: i.id, label: i.name })) },
  ];

  return (
    <div className="o-frame">
      <nav className="o-rail" aria-label="Workbench">
        {/* The Agent Relay logomark on top, on the workspace dropdown's line */}
        <span className="o-rail__logo" role="img" aria-label="Agent Relay" data-tip="Agent Relay" data-hint="Design workbench">
          <LogoIcon />
        </span>
        {AREAS.map((item) => (
          <RailItem
            key={item.label}
            area={item}
            active={item.area === area}
            onOpen={() => (item.area ? item.area !== area && goToArea(scenario, item.area) : openArea(scenario, item.view!))}
          />
        ))}
        <span className="o-rail__spacer" />
        <RailItem area={GUIDE} active={false} onOpen={() => openArea(scenario, GUIDE.view)} />
        <DropdownMenu
          side="top"
          align="start"
          className="o-rail__account"
          menuClassName="o-rail__menu"
          header={
            <span className="o-account">
              <span className="o-avatar o-avatar--lg">AS</span>
              <span className="o-account__text">
                <b>Ana Silva</b>
                <small>ana@example.test</small>
              </span>
            </span>
          }
          items={accountItems}
          trigger={({ toggle, triggerProps }) => (
            <button type="button" data-slot="o-rail" className="o-rail__item" aria-label="Ana Silva" data-tip="Ana Silva" data-hint="Account and appearance" {...triggerProps} onClick={toggle}>
              <span className="o-avatar">AS</span>
            </button>
          )}
        />
      </nav>
      <div className="o2-shell flat-shell">
      <AppShellFlat
        active={picked ? picked.name : pageLabel}
        onNavigate={(label) => {
          // Both areas have an "Overview" – look the label up in this area only
          const target = PAGES.find((p) => p.label === label && p.area === area);
          if (target && target.id !== page) return openPage(target.id);
          const found = data.initiatives.find((i) => i.name === label);
          if (found) show({ kind: "initiative", id: found.id });
          else {
            setPick(null);
            setHide((n) => n + 1);
          }
        }}
        workspace={data.org}
        workspaceMeta={data.workspace}
        user={{ name: "Ana Silva" }}
        nav={nav}
        groups={groups}
        sideCards={false}
        accountItems={accountItems}
        workspaceItems={[]}
        panel={
          <div className="o-pane flat-shell__panel">
            {/* The panel's own header: tabs on the app's header line, closing on the right */}
            <header className="o-pane__head">
              <div className="o-pane__tabs" role="tablist" data-single={tabs.length === 1 || undefined}>
                {tabs.map((t) => (
                  <button key={t} type="button" role="tab" data-slot="o-tab" className="o-pane__tab" aria-selected={t === currentTab} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <button type="button" data-slot="o-tab" className="o-pane__close" aria-label="Close details" title="Close" onClick={() => setHide((n) => n + 1)}>
                <PanelRight size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="o2-panel o-pane__body" data-empty={!picked && !pickedSession && !pickedPerson && !idle ? "" : undefined}>
              {/* With the variant's own detail views: one step back – a session to its initiative, else to the idle panel */}
              {((detail && idle && (picked || pickedSession || pickedOverlap || pickedPerson)) || backPerson) && (
                <button
                  type="button"
                  data-slot="o-back"
                  className="o-back"
                  onClick={() =>
                    back
                      ? setPick({ kind: "initiative", id: back.id })
                      : backOverlap
                        ? setPick({ kind: "overlap", id: backOverlap.id })
                        : backPerson
                          ? setPick({ kind: "person", id: backPerson.id })
                          : setPick(null)
                  }
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  {back ? back.name : backOverlap ? backOverlap.title : backPerson ? backPerson.name : period.title}
                </button>
              )}
              {pickedPerson ? (
                <PersonDetail
                  data={data}
                  personId={pickedPerson.id}
                  tab={currentTab}
                  onSession={(id) => setPick({ kind: "session", id, from: null, fromPerson: pickedPerson.id })}
                />
              ) : pickedOverlap ? (
                <OverlapDetail
                  item={pickedOverlap}
                  tab={currentTab}
                  onSession={(id) => setPick({ kind: "session", id, from: null, fromOverlap: pickedOverlap.id })}
                />
              ) : detail && picked ? (
                detail.initiative(picked, currentTab, (id) => setPick({ kind: "session", id, from: picked.id }))
              ) : detail && pickedSession ? (
                detail.session(pickedSession, currentTab)
              ) : picked ? (
                <InitiativePanel item={picked} tab={currentTab} onSession={(id) => setPick({ kind: "session", id, from: picked.id })} />
              ) : pickedSession ? (
                <SessionPanel item={pickedSession} tab={currentTab} back={back} onBack={(id) => setPick({ kind: "initiative", id })} />
              ) : idle ? (
                idle.render(data, show)
              ) : (
                <div className="o-pane__empty">
                  <span className="o-pane__empty-icon" aria-hidden="true">
                    <MousePointerClick size={18} strokeWidth={1.75} />
                  </span>
                  <p>Pick an initiative to see its update and the work behind it.</p>
                </div>
              )}
            </div>
          </div>
        }
        panelTitle="Details"
        defaultPanelOpen={panelOpenAtStart}
        panelReveal={reveal}
        panelHide={hide}
        onPanelOpenChange={onPanelOpenChange}
        commandGroups={commandGroups}
        onCommand={(id) => initiative(id) && show({ kind: "initiative", id })}
        commandPlaceholder="Jump to an initiative…"
        header={{ title: <h1 className="o2-title">{title}</h1>, actions: (
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
        <main className={`${className} flat-shell__content`}>{children(data, pick, show)}</main>
      </AppShellFlat>
      </div>
    </div>
  );
}

/** A rail icon; hovering (or focusing) it shows its name and what it is in a tooltip to the right */
function RailItem({ area, active, onOpen }: { area: { label: string; hint: string; icon: typeof Gauge }; active: boolean; onOpen: () => void }) {
  const Icon = area.icon;
  return (
    <button
      type="button"
      data-slot="o-rail"
      className="o-rail__item"
      aria-label={area.label}
      aria-description={area.hint}
      data-tip={area.label}
      data-hint={area.hint}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/**
 * How fresh the numbers are: "Updated 2m ago", and a button to fetch now. The page also refreshes
 * on its own every few minutes; summaries and initiatives change only when the analysis runs again.
 */
function Freshness({ at, onRefresh }: { at: number; onRefresh: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    // Auto-refresh every 5 minutes
    const auto = window.setInterval(onRefresh, 5 * 60_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(auto);
    };
  }, [onRefresh]);
  const minutes = Math.floor((now - at) / 60_000);
  const label = minutes < 1 ? "Updated just now" : `Updated ${minutes}m ago`;
  return (
    <span className="o-fresh">
      <span className="o-fresh__label" title="Refreshes on its own every 5 minutes">
        {label}
      </span>
      <button
        type="button"
        data-slot="o-fresh"
        className="o-fresh__btn"
        aria-label="Refresh now"
        title="Refresh now"
        data-spinning={spinning || undefined}
        onClick={() => {
          setSpinning(true);
          onRefresh();
          setNow(Date.now());
          window.setTimeout(() => setSpinning(false), 700);
        }}
      >
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </span>
  );
}
