// Design review helper: a small switch at the bottom center to flip between the current page's
// versions. It changes only the main area; the sidebars and the right panel stay the same.
import { keepPanelForReload, openArea } from "./Frame";
import { scenarioId } from "../scenarios";
import { pageFrom, rememberVersion } from "./pages";

export function VariantSwitch({ page, current }: { page: string; current: string }) {
  const config = pageFrom(page);
  const go = (id: string) => {
    rememberVersion(config.id, id);
    // Switching versions keeps the right panel as it is; opening a page starts with it closed
    keepPanelForReload();
    const url = new URL(location.href);
    url.searchParams.set("v", id);
    location.href = url.href;
  };
  return (
    <nav className="o-variants" aria-label={`${config.label} design version`}>
      {/* The dashboard redesign can be compared with the dashboard as it ships today */}
      {config.area === "dashboard" && (
        <button type="button" data-slot="o-variant" aria-pressed={false} onClick={() => openArea(scenarioId(location.pathname.split("/")[2]), "Dashboard")}>
          Current
        </button>
      )}
      {config.versions.map((label, i) => {
        const id = String(i + 1);
        return (
          <button key={id} type="button" data-slot="o-variant" aria-pressed={current === id} onClick={() => go(id)}>
            {config.versions.length === 1 ? "Redesign" : `v${id} ${label}`}
          </button>
        );
      })}
    </nav>
  );
}
