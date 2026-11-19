// In-app routes. Links use query parameters on the app's base path so they
// work on any static host without a history fallback. Hosted-style citation
// paths (`…/dashboard/sessions/<id>?source=<source>`) are accepted as well.
import { appPath } from "../app-path";
export type SessionRoute =
  | { view: "list"; q: string; tab: SessionTab }
  | { view: "graph"; sessionId?: string; source?: string; workspaceId?: string }
  | {
      view: "session";
      workspaceId?: string;
      sessionId: string;
      source: string;
      event: string | null;
      /** The list query (`q`, `tab`) to return to, so filters survive a visit. */
      from: string | null;
    }
  /** A session link without its source (Desktop's "View on web"): look the source up, then open it. */
  | {
      view: "resolve";
      workspaceId?: string;
      sessionId: string;
      event: string | null;
      from: string | null;
    };

const base = () => appPath();
export type SessionTab = "sessions" | "activity" | "overlaps" | "intel";
const LIST_TABS: readonly string[] = ["activity", "overlaps", "intel"];
const listTab = (tab: string | null): SessionTab =>
  tab && LIST_TABS.includes(tab) ? (tab as SessionTab) : "sessions";

export function parseRoute(location: {
  pathname: string;
  search: string;
  hash?: string;
}): SessionRoute {
  const params = new URLSearchParams(location.search);
  const workspace = params.get("workspace");
  if (params.get("view") === "graph") return {
    view: "graph", ...(workspace ? { workspaceId: workspace } : {}),
    ...(params.get("session") && params.get("source") ? { sessionId: params.get("session")!, source: params.get("source")! } : {}),
  };
  const hostedPath = /\/sessions\/([^/]+)\/?$/.exec(location.pathname);
  const sessionId =
    params.get("session") ?? (hostedPath ? safeDecode(hostedPath[1]!) : null);
  const source = params.get("source");
  if (sessionId) {
    const anchor = location.hash?.replace(/^#/, "") || null;
    const rest = {
      ...(workspace ? { workspaceId: workspace } : {}),
      sessionId,
      event: params.get("event") ?? anchorEvent(anchor),
      from: params.get("from"),
    };
    return source ? { view: "session", source, ...rest } : { view: "resolve", ...rest };
  }
  return {
    view: "list",
    q: params.get("q") ?? "",
    tab: listTab(params.get("tab")),
  };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `#message-<eventId>` and `#cell-<eventId>:<n>` are hosted transcript anchors. */
function anchorEvent(anchor: string | null) {
  const match = anchor
    ? /^(?:message|cell)-(.+?)(?::\d+)?$/.exec(anchor)
    : null;
  return match ? match[1]! : null;
}

export function sessionHref(
  sessionId: string,
  source: string,
  event?: string | null,
  from?: string | null,
  workspaceId?: string,
) {
  const params = new URLSearchParams({ session: sessionId, source });
  if (workspaceId) params.set("workspace", workspaceId);
  if (event) params.set("event", event);
  if (from) params.set("from", from);
  return `${base()}?${params}`;
}

export function listHref(
  q = "",
  tab: SessionTab = "sessions",
) {
  const params = new URLSearchParams();
  if (tab !== "sessions") params.set("tab", tab);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${base()}?${query}` : base();
}

/** The list URL a session page returns to, keeping its filters. */
export function backHref(from: string | null) {
  if (!from) return listHref();
  const params = new URLSearchParams(from);
  return listHref(params.get("q") ?? "", listTab(params.get("tab")));
}

/** The `from` value for links out of a list view. */
export function listState(q: string, tab: SessionTab) {
  const params = new URLSearchParams();
  if (tab !== "sessions") params.set("tab", tab);
  if (q) params.set("q", q);
  return params.toString() || null;
}

export function navigate(href: string) {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Let in-app links navigate without reloading, keeping modifier clicks. */
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href")!);
}

export function graphHref(workspaceId: string, focus?: { sessionId: string; source: string }) {
  return `${base()}?${new URLSearchParams({ view: "graph", workspace: workspaceId, ...(focus ?? {}) })}`;
}
