// Where the SPA is mounted. Self-hosted installs serve it at `/` and publish
// `window.__AGENT_RELAY_DASHBOARD_CONFIG__` from /runtime-config.js (appPath,
// loginPath); hosted builds use the Vite base (`/dashboard/`). Asset URLs
// always follow the build base, so build with DASHBOARD_BASE_PATH matching
// the runtime appPath.
type RuntimeConfig = {
  appPath?: unknown;
  loginPath?: unknown;
  sessionVisualizations?: unknown;
  sessionReadApi?: unknown;
  sessionAgentNames?: unknown;
  coordinationOverlaps?: unknown;
  analyticsEnabled?: unknown;
};

declare global {
  interface Window {
    __AGENT_RELAY_DASHBOARD_CONFIG__?: RuntimeConfig;
  }
}

function runtimeConfig(): RuntimeConfig {
  return (
    (typeof window !== "undefined" &&
      window.__AGENT_RELAY_DASHBOARD_CONFIG__) ||
    {}
  );
}

function withSlashes(path: string) {
  const leading = path.startsWith("/") ? path : `/${path}`;
  return leading.endsWith("/") ? leading : `${leading}/`;
}

/**
 * A same-origin path: rejects protocol-relative (`//host`, `/\\host`) and
 * absolute URLs, which browsers would send off-origin.
 */
function sameOriginPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const leading = path.startsWith("/") ? path : `/${path}`;
  return /^\/[/\\]/.test(leading) ? null : leading;
}

/** The app's base path, always with leading and trailing slashes. */
export function appPath(): string {
  const configured = sameOriginPath(runtimeConfig().appPath);
  if (configured) return withSlashes(configured);
  return withSlashes(import.meta.env.BASE_URL || "/");
}

/** relaycontrol's own sign-in page, returning to `next`. */
export function serverLoginHref(next: string): string {
  const configured = runtimeConfig().loginPath;
  const login =
    typeof configured === "string" && configured.startsWith("/")
      ? (sameOriginPath(configured) ?? "/login")
      : "/login";
  return `${login}?next=${encodeURIComponent(next)}`;
}

/**
 * Sign-in URL that returns to `next` (defaults to the current page). A
 * self-hosted install on the standard `/login` starts at the app's sign-in
 * page, which falls through to `/login` unless passwords are enabled. Hosted
 * builds and custom login paths go to the configured page directly.
 */
export function loginHref(
  next = `${window.location.pathname}${window.location.search}${window.location.hash}`,
): string {
  if (runtimeConfig().loginPath === "/login")
    return `${appPath()}#/sign-in?next=${encodeURIComponent(next)}`;
  return serverLoginHref(next);
}

/** Missing or malformed runtime flags keep the standard conversation view. */
export function sessionVisualizationsEnabled(): boolean {
  return runtimeConfig().sessionVisualizations === true;
}

/** Opt in only after Control and the reader support recorded agent metadata. */
export function sessionAgentNamesEnabled(): boolean {
  return runtimeConfig().sessionAgentNames === true;
}

/** Explicit operator opt-in; no URL, storage or hosted-key override. */
export function analyticsEnabled(): boolean {
  return runtimeConfig().analyticsEnabled === true;
}

/** Leave the current page. Tests replace this instead of `window.location`. */
export function redirectBrowser(href: string): void {
  window.location.replace(href);
}
