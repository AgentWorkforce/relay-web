// Cloud8865fe7 session-search.tsx, adapted to the selfhost query/agent contract.
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Check,
  CircleCheck,
  FolderGit2,
  Search,
  Users,
  X,
} from "lucide-react";
import { Button, Input } from "../shell/ui";
import { agentNames } from "./api";
import type { Member, SessionRow } from "./data";
import { HarnessIcon } from "./harness-icon";
import {
  agentDraft,
  completeAgent,
  matchesSuggestionFragment,
  parseSessionQuery,
  queryAgents,
  removeSessionFilter,
  selectSessionSuggestion,
  sessionSuggestions,
  suggestionToken,
  type SearchSuggestion,
} from "./query";
import { useLoad } from "./use-load";
import styles from "./sessions.module.css";

const tokenFor = (option: SearchSuggestion) =>
  option.field === "agent" ? `@${option.value}` : suggestionToken(option);

export function SessionSearch({
  workspaceId,
  query,
  onChange,
  tab,
  rows = [],
  members = [],
  now,
  busy = false,
}: {
  workspaceId: string;
  query: string;
  onChange: (value: string) => void;
  tab: "sessions" | "activity";
  rows?: SessionRow[];
  members?: Member[];
  now?: number;
  busy?: boolean;
}) {
  const [openedAt] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const titleId = useId();
  const filters = parseSessionQuery(query).filters;
  const agents = queryAgents(query);
  const draft = agentDraft(query);
  // The existing workspace-scoped roster is only fetched while typing @name.
  const roster = useLoad(draft === null ? null : workspaceId, (signal) =>
    agentNames(workspaceId, signal),
  );
  const options = sessionSuggestions(rows, members, now ?? openedAt);
  const last = /\s$/.test(query)
    ? ""
    : query.match(/(?:[^\s"]|"[^"]*")+/g)?.at(-1) || "";
  const suggestions: SearchSuggestion[] =
    draft !== null
      ? (roster.data ?? [])
          .filter((name) => name.toLowerCase().startsWith(draft))
          .slice(0, 8)
          .map((name) => ({
            field: "agent",
            value: name,
            title: `@${name}`,
            section: "Agents",
          }))
      : !last ||
          last.includes('"') ||
          options.some((option) => suggestionToken(option) === last)
        ? options
        : options.filter((option) => matchesSuggestionFragment(option, last));
  const index = suggestions.findIndex(
    (option) => tokenFor(option) === highlight,
  );
  const selected = suggestions[index];

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        open ||
        target?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open]);

  // Match the existing webapp modal's Escape/Tab handling without a new dependency.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const returnTrigger = trigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        setOpen(false);
        setHighlight(null);
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panel.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !panel.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      // Escape, submit and the close button all return to the compact trigger.
      if (returnTrigger?.isConnected) returnTrigger.focus();
      else if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    list.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlight]);

  function close() {
    setOpen(false);
    setHighlight(null);
  }
  function change(next: string) {
    setHighlight(null);
    onChange(next);
  }
  function choose(option: SearchSuggestion, add = true) {
    const token = tokenFor(option);
    setHighlight(token);
    onChange(
      option.field === "agent"
        ? add
          ? completeAgent(query, option.value)
          : filters
              .filter(
                (filter) =>
                  filter.field === "agent" &&
                  filter.value.toLowerCase() === option.value.toLowerCase(),
              )
              .reduce(
                (next, filter) => removeSessionFilter(next, filter.raw),
                query,
              )
        : selectSessionSuggestion(query, option, add),
    );
    input.current?.focus();
  }

  return (
    <div className={styles.searchControl}>
      <div className={styles.searchBar}>
        <Search
          size={16}
          aria-hidden="true"
          className="ml-3 shrink-0 text-muted-foreground"
        />
        {filters.length > 0 && (
          <ul className={styles.searchChips} aria-label="Active filters">
            {filters.map((filter, i) => (
              <li key={`${filter.raw}:${i}`}>
                <button
                  type="button"
                  aria-label={`Remove filter ${filter.raw}`}
                  onClick={() => change(removeSessionFilter(query, filter.raw))}
                >
                  {filter.raw}
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          ref={trigger}
          type="button"
          className={styles.searchTrigger}
          onClick={() => setOpen(true)}
          aria-label="Search and filter sessions"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="truncate">
            {parseSessionQuery(query).text ||
              (filters.length ? "Add filters…" : "Search or filter sessions…")}
          </span>
          <kbd>/</kbd>
        </button>
        {!!query && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear search"
            onClick={() => change("")}
          >
            <X />
          </Button>
        )}
      </div>
      {tab === "sessions" && agents.length > 0 && (
        <p role="status" className="mt-1 text-[11px] text-muted-foreground">
          {agents.length > 1 && `One agent at a time: showing @${agents[0]}. `}
          Sessions still being uploaded aren’t included.
        </p>
      )}
      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50 bg-black/50"
              aria-hidden="true"
              onClick={close}
            />
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              data-slot="sheet-content"
              className={`${styles.searchPanel} fixed z-50 flex flex-col bg-background shadow-lg`}
            >
              <h2 id={titleId} className="sr-only">
                Search and filter sessions
              </h2>
              <form
                role="search"
                autoComplete="off"
                aria-label="Search sessions and filters"
                aria-busy={busy}
                className={styles.searchForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (selected) choose(selected);
                  close();
                }}
              >
                <div
                  className={styles.searchInputGroup}
                  data-slot="input-group"
                >
                  <Search size={16} aria-hidden="true" />
                  <Input
                    ref={input}
                    name="q"
                    autoComplete="off"
                    maxLength={500}
                    value={query}
                    placeholder="Search sessions, @agent, or add filters…"
                    role="combobox"
                    aria-label="Search sessions"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      selected ? `${listId}-${index}` : undefined
                    }
                    onChange={(event) => change(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.nativeEvent.isComposing ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.altKey
                      )
                        return;
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        const next = highlight
                          ? Math.max(
                              0,
                              Math.min(
                                suggestions.length - 1,
                                index + (event.key === "ArrowDown" ? 1 : -1),
                              ),
                            )
                          : 0;
                        setHighlight(
                          suggestions[next]
                            ? tokenFor(suggestions[next])
                            : null,
                        );
                      } else if (
                        selected &&
                        (event.key === "ArrowRight" ||
                          event.key === "ArrowLeft")
                      ) {
                        event.preventDefault();
                        choose(selected, event.key === "ArrowRight");
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close search"
                    onClick={close}
                  >
                    <X />
                  </Button>
                </div>
              </form>
              <div ref={list} className={styles.searchSuggestions}>
                <Button
                  variant="ghost"
                  className="w-full justify-between"
                  onClick={close}
                >
                  Search conversations <kbd>↵</kbd>
                </Button>
                <div
                  id={listId}
                  role="listbox"
                  aria-label={
                    draft !== null ? "Agent suggestions" : "Session filters"
                  }
                >
                  {suggestions.map((option, i) => {
                    const token = tokenFor(option);
                    const checked = filters.some(
                      (filter) =>
                        !filter.exclude &&
                        filter.field === option.field &&
                        filter.value.toLowerCase() ===
                          option.value.toLowerCase(),
                    );
                    const Icon =
                      option.field === "project"
                        ? FolderGit2
                        : option.field === "is"
                          ? CircleCheck
                          : option.field === "updated"
                            ? CalendarDays
                            : Users;
                    return (
                      <Fragment key={token}>
                        {(i === 0 ||
                          suggestions[i - 1]!.section !== option.section) && (
                          <div
                            className={styles.suggestionSection}
                            role="presentation"
                          >
                            {option.section}
                          </div>
                        )}
                        <div
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={i === index}
                          data-highlighted={i === index}
                          className={styles.suggestion}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(option, !checked)}
                        >
                          {option.field === "harness" ? (
                            <HarnessIcon
                              source={option.value}
                              className="size-5"
                            />
                          ) : (
                            <Icon size={18} aria-hidden="true" />
                          )}
                          <span>{option.title}</span>
                          <code>{token}</code>
                          {checked && <Check size={14} aria-label="Selected" />}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
                {draft !== null && roster.loading && (
                  <p
                    role="status"
                    className="p-3 text-xs text-muted-foreground"
                  >
                    Loading agent suggestions…
                  </p>
                )}
                {draft !== null && roster.error && (
                  <p
                    role="status"
                    className="p-3 text-xs text-muted-foreground"
                  >
                    Agent suggestions unavailable. Enter a full @name to search.
                  </p>
                )}
                {!suggestions.length &&
                  !(draft !== null && (roster.loading || roster.error)) && (
                    <p className="p-3 text-xs text-muted-foreground">
                      {draft !== null
                        ? "No matching agents. Enter a full @name to search."
                        : "No filter suggestions. Press Enter to search."}
                    </p>
                  )}
              </div>
              <div className={styles.searchHelp}>
                {help && (
                  <p id={`${listId}-help`}>
                    Combine words with harness:codex, project:relay, is:active,
                    is:idle, is:finished or person:&lt;id&gt;. Use @name or
                    @name* for one agent; agent and text combinations depend on
                    the backend. Quote project names with spaces. Prefix a
                    filter with - to exclude it. Dates use UTC:
                    updated:&gt;=2026-10-01. Text search scope and availability
                    depend on the workspace backend; filters may apply only to
                    loaded sessions.
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    aria-expanded={help}
                    aria-controls={`${listId}-help`}
                    onClick={() => setHelp(!help)}
                  >
                    Search syntax tips
                  </button>
                  <span>
                    ↑ ↓ navigate · → select · ← remove · ↵ search · Esc close
                  </span>
                  {!!query && (
                    <button type="button" onClick={() => change("")}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <span className="sr-only" role="status">
                {busy ? "Searching conversations…" : ""}
              </span>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
