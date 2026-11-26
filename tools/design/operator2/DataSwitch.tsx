// The design-review bar at the bottom centre of the main area. Always: the same page with no entries, a
// few, or many – so every page is designed for the empty state and for a real company's scale. On pages
// with more than one layout, a "v1 | v2" switch for that page's layout sits next to it. (The design round
// for the whole prototype is the separate switch at the bottom of the sidebar.)
import { useLayoutEffect, useState } from "react";
import type { Density } from "./data";

const OPTIONS: { id: Density; label: string }[] = [
  { id: "none", label: "None" },
  { id: "few", label: "A few" },
  { id: "many", label: "Many" },
];

export function DataSwitch({
  value,
  onChange,
  layout,
}: {
  value: Density;
  onChange: (d: Density) => void;
  /** This page's layouts, when it has more than one */
  layout?: { count: number; value: number; onChange: (v: number) => void };
}) {
  const [center, setCenter] = useState<number | null>(null);
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>(".flat-shell__content");
    if (!main) return;
    const place = () => {
      const r = main.getBoundingClientRect();
      setCenter(Math.round(r.left + r.width / 2));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(main);
    addEventListener("resize", place);
    return () => {
      ro.disconnect();
      removeEventListener("resize", place);
    };
  }, []);
  return (
    <div className="review-bar" style={center === null ? undefined : { left: center }}>
      {layout && layout.count > 1 && (
        <nav className="data-switch" aria-label="This page's layout">
          {Array.from({ length: layout.count }, (_, i) => i + 1).map((v) => (
            <button key={v} type="button" data-slot="data-switch" aria-pressed={layout.value === v} title={`Layout ${v} of this page`} onClick={() => layout.onChange(v)}>
              v{v}
            </button>
          ))}
        </nav>
      )}
      <nav className="data-switch" aria-label="How many entries">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" data-slot="data-switch" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
