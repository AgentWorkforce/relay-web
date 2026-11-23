import type { ThemePreference } from "../../src/shell/theme";
import type { ScenarioId } from "./scenarios";

export function validPreviewRoute(
  value: unknown,
  scenario: ScenarioId,
): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value, "http://design.test");
    return url.origin === "http://design.test" &&
      url.pathname.startsWith(`/preview/${scenario}/`)
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}

export function previewDataEntry(route: string) {
  const url = new URL(route, "http://design.test");
  if (url.searchParams.has("session")) return "events";
  if (url.hash.startsWith("#/settings/usage/people/")) return "people";
  return url.hash.startsWith("#/settings/usage") ? "usage" : "sessions";
}

/** Development frame bridge; production history and theme code stay untouched. */
export function installPreviewBridge(
  target: Window,
  onRoute: (route: string) => void,
  onTheme: (theme: ThemePreference) => void,
) {
  const history = target.history;
  const push = history.pushState;
  const replace = history.replaceState;
  const report = () =>
    onRoute(
      target.location.pathname + target.location.search + target.location.hash,
    );
  const pushAndReport: History["pushState"] = function (...args) {
    push.apply(history, args);
    report();
  };
  const replaceAndReport: History["replaceState"] = function (...args) {
    replace.apply(history, args);
    report();
  };
  history.pushState = pushAndReport;
  history.replaceState = replaceAndReport;
  const theme = (event: MessageEvent) => {
    if (
      event.source !== target.parent ||
      event.origin !== target.location.origin
    )
      return;
    const value = event.data?.preference;
    if (
      event.data?.type === "design-theme" &&
      (value === "light" || value === "dark" || value === "system")
    )
      onTheme(value);
  };
  target.addEventListener("popstate", report);
  target.addEventListener("hashchange", report);
  target.addEventListener("message", theme);
  report();
  return () => {
    if (history.pushState === pushAndReport) history.pushState = push;
    if (history.replaceState === replaceAndReport)
      history.replaceState = replace;
    target.removeEventListener("popstate", report);
    target.removeEventListener("hashchange", report);
    target.removeEventListener("message", theme);
  };
}
