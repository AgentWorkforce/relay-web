// A link to a session's own page in the prototype. A real link (so it can open in a new tab with a
// modifier key), but a plain click moves within the app like every other page change.
import type { MouseEvent, ReactNode } from "react";
import type { Go } from "./App";
import { VIEW_PARAMS } from "./urlState";

export function SessionLink({ id, go, className, slot, title, children }: { id: string; go: Go; className?: string; slot?: string; title?: string; children: ReactNode }) {
  const url = new URL(location.href);
  url.searchParams.set("page", "session");
  url.searchParams.set("id", id);
  for (const key of VIEW_PARAMS) url.searchParams.delete(key);
  const open = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go({ page: "session", id });
  };
  return (
    <a href={url.pathname + url.search} className={className} data-slot={slot} title={title} onClick={open}>
      {children}
    </a>
  );
}
