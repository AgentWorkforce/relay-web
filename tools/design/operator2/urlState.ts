// View state that belongs in the link, so a copied URL opens exactly what you were looking at – the task
// page's tab, the artifact that's open, the day picked in the cost chart, Model or Person. (Khaliq: pages
// should be deep-linkable, "grab Ana to discuss this task … deep link to that page".)
// Changes replace the current history entry: flipping a tab isn't a page you'd want "back" to step through.
import { useState } from "react";

/** The view parameters – dropped when moving to another page, so they don't leak into it */
export const VIEW_PARAMS = ["tab", "artifact", "day", "by"] as const;
type ViewParam = (typeof VIEW_PARAMS)[number];

const read = (key: ViewParam) => new URLSearchParams(location.search).get(key);

function write(key: ViewParam, value: string | null) {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(history.state, "", url);
}

/** A choice from a fixed set; the default isn't written, so plain links stay short */
export function useUrlChoice<T extends string>(key: ViewParam, choices: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = read(key);
    return choices.includes(v as T) ? (v as T) : fallback;
  });
  const set = (v: T) => {
    setValue(v);
    write(key, v === fallback ? null : v);
  };
  return [value, set];
}

/** An optional value – an id, a date – or nothing */
export function useUrlValue(key: ViewParam): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => read(key));
  const set = (v: string | null) => {
    setValue(v);
    write(key, v);
  };
  return [value, set];
}
