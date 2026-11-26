// The workbench's generation switch, bottom left: v1 is the prototype as Khaliq reviewed it on
// 25 Nov 2026 and stays frozen; v2 is the iteration on his feedback, where every change goes from now on.
// `?gen=1|2` in a link picks one and is remembered; without either, v2 opens.
import { useLayoutEffect, useState } from "react";

const KEY = "agent-relay.workbench.gen";
export type Gen = "1" | "2";

export function currentGen(): Gen {
  const fromUrl = new URLSearchParams(location.search).get("gen");
  if (fromUrl === "1" || fromUrl === "2") {
    try {
      localStorage.setItem(KEY, fromUrl);
    } catch {
      // Storage blocked – the link still decides for this visit
    }
    return fromUrl;
  }
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "1" || kept === "2") return kept;
  } catch {
    // Storage blocked – fall back to the newest
  }
  return "2";
}

function switchTo(gen: Gen) {
  const url = new URL(location.href);
  url.searchParams.set("gen", gen);
  // Each generation has its own pages; start each on its first page
  url.searchParams.delete("page");
  url.searchParams.delete("v");
  url.searchParams.delete("id");
  // v2 lives in the operator area only
  if (gen === "2") url.pathname = url.pathname.replace(/^\/dashboard\//, "/operator/");
  location.href = url.href;
}

/**
 * Sits at the bottom of the wide sidebar, in both generations – never over the page's content.
 * In v2 the account sits at the sidebar's foot, so the switch stays just above it.
 */
export function GenSwitch({ gen }: { gen: Gen }) {
  const [left, setLeft] = useState(16);
  useLayoutEffect(() => {
    const side = document.querySelector<HTMLElement>(".ui-as-side");
    if (!side) return;
    const place = () => setLeft(Math.round(side.getBoundingClientRect().left) + 12);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(side);
    addEventListener("resize", place);
    return () => {
      ro.disconnect();
      removeEventListener("resize", place);
    };
  }, []);
  return (
    <nav className="gen-switch" aria-label="Design round" style={{ left, bottom: gen === "2" ? 60 : 16 }}>
      {(["1", "2"] as const).map((g) => (
        <button key={g} type="button" data-slot="gen-switch" aria-pressed={gen === g} title={g === "1" ? "The whole design as reviewed on 25 Nov" : "The whole design, current iteration"} onClick={() => gen !== g && switchTo(g)}>
          Round {g}
        </button>
      ))}
    </nav>
  );
}
