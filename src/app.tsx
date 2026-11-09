import { useEffect, useState } from "react";
import { Dashboard } from "./dashboard";
import { FlowsApp, parseFlowsRoute } from "./flows/flows-app";
import { Settings } from "./admin/settings";
import { DownloadsPage, isDownloadsPath } from "./admin/downloads";
import { DevicePage } from "./device/DevicePage";
import { userCodeFromHash } from "./device/api";
import { parseRoute } from "./sessions/route";
import { Shell } from "./shell/shell";
import { MessagingPanel } from "./messaging/panel";
import { ChiefPage } from './chief/chief-page';

/** Hash routes keep the static host simple (no SPA fallback needed). */
function route(hash: string) {
  if (hash === "#/downloads" || (!hash && isDownloadsPath(window.location.pathname)))
    return { page: "downloads" as const, path: "", section: "" };
  const chief = /^#(\/chief(?:\/.*)?)$/.exec(hash);
  if (chief) return { page: 'chief' as const, path: chief[1]!, section: '' };
  // Device approval (relaycontrol redirects verification_uri here).
  if (/^#\/device(?:\?.*)?$/.test(hash))
    return { page: "device" as const, path: "", section: "" };
  const flows = /^#(\/flows(?:\/.*)?)$/.exec(hash);
  if (flows) return { page: "flows" as const, path: flows[1]!, section: "" };
  if (hash === "#/messages" || hash.startsWith("#/messages?"))
    return { page: "messages" as const, path: "", section: "" };
  const settings = /^#\/settings(?:\/([a-z-]+))?$/.exec(hash);
  if (settings)
    return {
      page: "settings" as const,
      path: "",
      section: settings[1] ?? "workspace",
    };
  return { page: "sessions" as const, path: "", section: "" };
}

/** Hosted workspaceSection(): the rail and default topbar heading per route. */
function chrome(current: ReturnType<typeof route>) {
  if (current.page === 'chief') return { rail: 'Chief' as const, label: 'Chief' };
  if (current.page === "flows") {
    const kind = parseFlowsRoute(current.path).kind;
    return {
      rail: "Flows" as const,
      label:
        kind === "run"
          ? "Run details"
          : kind === "flow"
            ? "Flow settings"
            : kind === "runs"
              ? "Run history"
              : kind.includes("worker")
                ? "Workers"
                : "Flows",
    };
  }
  if (current.page === "messages")
    return { rail: "Agents" as const, label: "Messages" };
  if (current.page === "settings")
    return { rail: "Settings" as const, label: "Settings" };
  if (current.page === "downloads")
    return { rail: "Settings" as const, label: "Downloads" };
  return {
    rail: "Agents" as const,
    label: parseRoute(window.location).view === "session" ? "Session" : "Sessions",
  };
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  // In-app session links use pushState + popstate; re-render for the heading.
  const [, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const update = () => {
      setHash(window.location.hash);
      setSearch(window.location.search);
    };
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const current = route(hash);
  if (current.page === "device") {
    const code = userCodeFromHash(hash);
    // A different code is a different request: start the page fresh.
    return <DevicePage key={code} initialUserCode={code} />;
  }
  const { rail, label } = chrome(current);
  return (
    <Shell rail={rail} label={label}>
      {current.page === 'chief' && <ChiefPage path={current.path} />}
      {current.page === "flows" && <FlowsApp path={current.path} />}
      {current.page === "settings" && <Settings section={current.section} />}
      {current.page === "downloads" && <DownloadsPage />}
      {current.page === "messages" && <MessagingPanel />}
      {current.page === "sessions" && <Dashboard />}
    </Shell>
  );
}
