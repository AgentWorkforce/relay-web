// Entry for the operator view (served at /operator/<scenario>/ by the workbench's Vite server).
// ?page=overview|overlaps|spend|map picks the page, ?v=1|2|3 its design version (default: overview, v1). Stylesheet order matters: globals declare
// the cascade layers, then the Agent Relay theme on affectUI tokens, the type scale, font, pages.
import "../styles.css";
import "../../../src/brand.css";
import "../../../src/styles.css";
import "./fonts.css";
import "./theme/agent-relay-theme.css";
import "./theme/scale.css";
import "./theme/flat-shell.css";
import "./operator-v1.css";
import "./operator-v23.css";
import "./home-v1.css";
import "./home-v2.css";
import "./home-v3.css";
import "./dash-overview.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { initTheme, setThemePreference } from "../../../src/shell/theme";
import { installPreviewBridge } from "../preview-navigation";
import { scenarioId } from "../scenarios";
import { OperatorV1 } from "./OperatorV1";
import { OperatorV2 } from "./OperatorV2";
import { OperatorV3 } from "./OperatorV3";
import { OverlapsV1, OverlapsV2, OverlapsV3 } from "./OverlapsPage";
import { SpendPage } from "./SpendPage";
import { MapPage } from "./MapPage";
import { MapPairs, MapTrees } from "./MapViews";
import { SessionsPage } from "./SessionsPage";
import { DashOverview } from "./DashOverview";
import { PeoplePage } from "./HomeV2";
import { pageFrom, rememberVersion } from "./pages";
import { VariantSwitch } from "./VariantSwitch";

const scenario = scenarioId(location.pathname.split("/")[2]);
const params = new URLSearchParams(location.search);
const page = pageFrom(params.get("page"));
const v = params.get("v") ?? "1";
rememberVersion(page.id, v);
const VERSIONS = {
  overview: [OperatorV1, OperatorV2, OperatorV3],
  overlaps: [OverlapsV1, OverlapsV2, OverlapsV3],
  spend: [SpendPage],
  map: [MapPage, MapTrees, MapPairs],
  home: [DashOverview],
  sessions: [SessionsPage],
  people: [PeoplePage],
} as const;
const versions: readonly ((props: { scenario: typeof scenario }) => React.ReactNode)[] = VERSIONS[page.id];
const Page = versions[Math.min(versions.length - 1, Math.max(0, Number(v) - 1))] ?? versions[0]!;
initTheme();
const stopBridge = installPreviewBridge(window, () => {}, setThemePreference);
import.meta.hot?.dispose(stopBridge);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Page scenario={scenario} />
    {/* Only pages with several design versions get the switch */}
    {(page.versions.length > 1 || page.area === "dashboard") && <VariantSwitch page={page.id} current={v} />}
  </React.StrictMode>,
);
