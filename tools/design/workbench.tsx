import { PipelineSample } from "./pipeline-sample";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Code2, Copy, Layers, Moon, Sun } from "lucide-react";
import { Button } from "../../src/shell/ui";
import { setThemePreference, themePreference } from "../../src/shell/theme";
import { catalog } from "./catalog";
import { validPreviewRoute, previewDataEntry } from "./preview-navigation";
import { OperatorConcept } from "./operator-concept";
import { CatalogPanel } from "./catalog-panel";
import { GuidePanel } from "./guide-panel";
import {
  dataset,
  proposedInitiatives,
  scenarioId,
  scenarios,
  type ScenarioId,
} from "./scenarios";

const views = [
  "Dashboard",
  "Operator concept",
  "Pipeline sample",
  "Data catalog",
  "Start here",
] as const;
type View = (typeof views)[number];
type Surface = "usage" | "sessions" | "person";
const viewFrom = (value: string | null): View =>
  views.find((view) => view === value) ?? "Dashboard";
const surfaceFrom = (value: string | null): Surface =>
  value === "sessions" || value === "person" ? value : "usage";
const previewPath = (
  scenario: ScenarioId,
  surface: Surface,
  session?: { sessionId: string; source: string },
) =>
  `/preview/${scenario}/${session ? `?${new URLSearchParams({ session: session.sessionId, source: session.source })}` : surface === "usage" ? "#/settings/usage" : surface === "person" ? "#/settings/usage/people/design-ana" : ""}`;

function download(value: unknown, name: string, raw = false) {
  const url = URL.createObjectURL(
    new Blob([raw && typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workbench() {
  const initial = new URLSearchParams(location.search);
  const [scenario, setScenario] = useState(() =>
    scenarioId(initial.get("scenario")),
  );
  const [savedPreview, setSavedPreview] = useState(() =>
    validPreviewRoute(
      initial.get("preview"),
      scenarioId(initial.get("scenario")),
    ),
  );
  const [currentPreview, setCurrentPreview] = useState<string | null>(null);
  const [navigationId, setNavigationId] = useState(0);
  const [project, setProject] = useState(
    () =>
      proposedInitiatives.find((p) => p.name === initial.get("project"))
        ?.name ?? null,
  );
  const [view, setView] = useState<View>(() => viewFrom(initial.get("view")));
  const [surface, setSurface] = useState<Surface>(() =>
    surfaceFrom(initial.get("surface")),
  );
  const [entryId, setEntryId] = useState(
    () => catalog.find((e) => e.id === initial.get("data"))?.id ?? "sessions",
  );
  const [width, setWidth] = useState(() =>
    initial.get("width") === "mobile" ? "mobile" : "desktop",
  );
  const [theme, setTheme] = useState(themePreference);
  const [copy, setCopy] = useState("");
  const [focus, setFocus] = useState<
    { sessionId: string; source: string } | undefined
  >();
  const [reads, setReads] = useState<Array<{ path: string; status: number }>>(
    [],
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const pipelineView = view === "Pipeline sample" || (view === "Data catalog" && catalog.find(entry => entry.id === entryId)?.fixedCohort === true);
  const scenarioInfo = scenarios.find((item) => item.id === scenario)!;
  const data = dataset(scenario);
  const requestedPreview =
    savedPreview ?? previewPath(scenario, surface, focus);
  const preview = currentPreview ?? requestedPreview;
  const currentData = previewDataEntry(preview);
  const currentSurface =
    currentData === "people"
      ? "person"
      : currentData === "usage"
        ? "usage"
        : "sessions";

  useEffect(() => {
    const query = new URLSearchParams({
      scenario,
      view,
      surface,
      data: entryId,
      width,
    });
    query.set("preview", preview);
    if (project) query.set("project", project);
    history.replaceState(null, "", `/?${query}`);
  }, [scenario, view, surface, entryId, width, preview, project]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const data = event.data as {
        type?: string;
        path?: unknown;
        status?: unknown;
        route?: unknown;
      };
      if (data?.type === "design-route") {
        const route = validPreviewRoute(data.route, scenario);
        if (route) setCurrentPreview(route);
      }
      if (
        data?.type === "design-read" &&
        typeof data.path === "string" &&
        typeof data.status === "number"
      ) {
        const item = { path: data.path, status: data.status };
        setReads((previous) => [...previous.slice(-19), item]);
      }
    };
    addEventListener("message", receive);
    return () => removeEventListener("message", receive);
  }, [scenario]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("Copied");
    } catch {
      setCopy("Copy unavailable. Select the JSON or download it.");
    }
  }
  function copyViewLink() {
    const url = new URL(location.href);
    if (view === "Dashboard") url.searchParams.set("preview", preview);
    void copyText(url.href);
  }
  function showSession(sessionId: string) {
    const session = data.find(({ row }) => row.sessionId === sessionId)?.row;
    if (session) {
      setSavedPreview(null);
      setCurrentPreview(null);
      setNavigationId((id) => id + 1);
      setFocus(session);
      setSurface("sessions");
      setReads([]);
      setView("Dashboard");
    }
  }
  function inspect(id: string) {
    setEntryId(id);
    setCopy("");
    setView("Data catalog");
  }

  return (
    <div className="design-workbench">
      <aside className="design-rail">
        <a className="design-wordmark" href="/">
          relay<span> / studio</span>
        </a>
        <p className="design-eyebrow">Design workbench</p>
        <nav aria-label="Workbench">
          {views.map((item, index) => (
            <button
              key={item}
              aria-current={view === item ? "page" : undefined}
              onClick={() => setView(item)}
            >
              <span>0{index + 1}</span>
              {item}
            </button>
          ))}
        </nav>
        <div className="design-rail-note">
          <Layers size={18} />
          <strong>{pipelineView ? "Source-owned fixture. Invented data." : <>Real components.<br />Invented organization.</>}</strong>
          <p>{pipelineView ? "A separate frozen synthetic pipeline cohort; no real workspace data." : "Everything here belongs to the fictional Northstar Studio."}</p>
        </div>
        <a
          className="design-source-link"
          href="https://github.com/AgentWorkforce/relay-web"
          target="_blank"
          rel="noreferrer"
        >
          Open source <ArrowUpRight size={14} />
        </a>
      </aside>
      <div className="design-content">
        <header className="design-header">
          <div>
            <span className="design-status-dot" />
            Local design environment{" "}
            <span className="design-header-divider">/</span> Synthetic data only
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Toggle theme"
            onClick={() => {
              const next = theme === "light" ? "dark" : "light";
              setThemePreference(next);
              setTheme(next);
              frame.current?.contentWindow?.postMessage(
                { type: "design-theme", preference: next },
                location.origin,
              );
            }}
          >
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </Button>
        </header>
        <main className="design-main">
          <div className="design-heading">
            <div>
              <p className="design-eyebrow">Agent Relay · Designer kit</p>
              <h1>
                {view === "Dashboard"
                  ? "Build with the real thing."
                  : view === "Operator concept"
                    ? "Start with the decisions."
                    : view === "Pipeline sample"
                      ? "Build against the source contract."
                    : view === "Data catalog"
                      ? "Know what’s behind the UI."
                      : "A smaller loop, a clearer signal."}
              </h1>
              <p>
                {view === "Dashboard"
                  ? "Edit the dashboard’s source. See your changes here, with a team already in place."
                  : view === "Operator concept"
                    ? "A conversation starter for the operator view. All synthesis fields below are proposed."
                    : view === "Pipeline sample"
                      ? "A computed synthetic artifact, with coverage and evidence you can inspect."
                    : view === "Data catalog"
                      ? "Response examples, field meanings and honest limits, next to each other."
                      : "Your first iteration is one operator overview and one project drill-down."}
              </p>
            </div>
            <span className="design-pill">Development only</span>
          </div>
          <div className="design-controls">
            <label>
              Scenario
              <select
                disabled={pipelineView}
                value={scenario}
                onChange={(e) => {
                  setScenario(scenarioId(e.target.value));
                  setSavedPreview(null);
                  setCurrentPreview(null);
                  setNavigationId((id) => id + 1);
                  setProject(null);
                  setFocus(undefined);
                  setReads([]);
                  setCopy("");
                }}
              >
                {scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p>{pipelineView ? "Frozen source cohort; the scenario selector does not apply." : scenarioInfo.description}</p>
            <Button variant="outline" size="sm" onClick={copyViewLink}>
              <Copy size={14} /> Copy view link
            </Button>
          </div>
          <p className="design-copy-status" role="status">
            {copy}
          </p>

          <section
            aria-label="Production dashboard preview"
            hidden={view !== "Dashboard"}
          >
            <div className="design-preview-toolbar">
              <div role="group" aria-label="Dashboard surface">
                {(["usage", "sessions", "person"] as const).map((item) => (
                  <Button
                    key={item}
                    variant={currentSurface === item ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setSurface(item);
                      setSavedPreview(null);
                      setCurrentPreview(null);
                      setNavigationId((id) => id + 1);
                      setFocus(undefined);
                      setReads([]);
                    }}
                  >
                    {item === "usage"
                      ? "Team usage"
                      : item === "sessions"
                        ? "Sessions"
                        : "Person drill-down"}
                  </Button>
                ))}
              </div>
              <div className="design-inline">
                <label className="design-width-label">
                  Width
                  <select
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  >
                    <option value="desktop">Desktop</option>
                    <option value="mobile">390 px</option>
                  </select>
                </label>
                <a href={preview} target="_blank" rel="noreferrer">
                  Open preview <ArrowUpRight size={13} />
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => inspect(currentData)}
                >
                  <Code2 size={14} /> Data
                </Button>
              </div>
            </div>
            <div className="design-preview-stage">
              <iframe
                key={`${scenario}-${navigationId}`}
                ref={frame}
                title="Real dashboard with synthetic data"
                src={requestedPreview}
                className={width === "mobile" ? "design-preview-mobile" : ""}
              />
            </div>
            <details className="design-network">
              <summary>Fixture reads · {reads.length} recent requests</summary>
              <p>
                Reads are answered in memory. Unconfigured routes and writes are
                refused. No request falls through to a live backend.
              </p>
              <ul>
                {reads.map((read, i) => (
                  <li key={i}>
                    <code>
                      {read.status} GET {read.path}
                    </code>
                  </li>
                ))}
              </ul>
            </details>
            <p className="design-footnote">
              Same App, shell, SessionsPage and UsageSection as production. Edit{" "}
              <code>src/</code> to change those components; this workbench lives
              in <code>tools/design/</code>.
            </p>
          </section>

          {view === "Operator concept" && (
            <OperatorConcept
              scenario={scenario}
              project={project}
              onProject={setProject}
              onInspect={inspect}
              onSession={showSession}
            />
          )}

          {view === "Pipeline sample" && <PipelineSample onDownload={download} />}

          {view === "Data catalog" && (
            <CatalogPanel
              scenario={scenario}
              entryId={entryId}
              copy={copy}
              onSelect={(id) => {
                setEntryId(id);
                setCopy("");
              }}
              onCopy={copyText}
              onDownload={download}
            />
          )}

          {view === "Start here" && (
            <GuidePanel
              scenario={scenario}
              onConcept={() => setView("Operator concept")}
              onDownload={download}
            />
          )}
        </main>
      </div>
    </div>
  );
}
