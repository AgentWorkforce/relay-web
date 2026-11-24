// Dashboard Home v1 – "List" (after Linear's issue list). One quiet header line with a small usage
// strip, one toolbar (search, Person / Harness / Status facets, Group by), then every session in one
// calm list: what is running now first, then the rest under small group headers with counts. A row
// is two lines – title, then the one-line summary – and opens the session in the right panel.
import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  CircleDot,
  FolderOpen,
  Layers,
  Monitor,
  Search,
  SquareTerminal,
  User,
  Users,
  X,
} from "lucide-react";
import { DropdownMenu, type DropdownMenuItem } from "../../../src/affectui/registry/dropdown-menu/component.clean";
import { fixtureClock } from "../scenarios";
import { ago, type Overview, type SessionItem } from "./model";
import type { Pick } from "./OperatorV1";
import { HARNESS_LABELS, HarnessLogo, Initials } from "./WeekPanel";

/* ---------- Data helpers ---------- */

type Row = SessionItem & { project: string };

/** Every session once, each with the project (repo) it belongs to */
function rowsOf(data: Overview): Row[] {
  const seen = new Map<string, Row>();
  for (const p of data.projects) for (const s of p.sessions) if (!seen.has(s.id)) seen.set(s.id, { ...s, project: p.name });
  for (const i of data.initiatives) for (const s of i.sessions) if (!seen.has(s.id)) seen.set(s.id, { ...s, project: i.name });
  return [...seen.values()].sort((a, b) => Date.parse(b.lastTs) - Date.parse(a.lastTs));
}

type StatusId = "active" | "paused" | "finished";
const statusOf = (s: SessionItem): StatusId => (s.status === "active" ? "active" : s.status === "finished" ? "finished" : "paused");
const STATUS_LABELS: Record<StatusId, string> = { active: "Running", paused: "Paused", finished: "Finished" };
const harnessName = (id: string) => HARNESS_LABELS[id] ?? id;
const periodWord = (data: Overview) => (data.period.days === 1 ? "today" : data.period.days === 7 ? "this week" : "this month");

/** Today / Yesterday / Mon 16 Nov – by the day the session was last active */
function dayOf(ts: string) {
  const now = new Date(fixtureClock);
  const d = new Date(ts);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  const label =
    diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return { key: String(start(d)), label };
}

const GROUPINGS = [
  { id: "day", label: "Day", icon: CalendarDays },
  { id: "person", label: "Person", icon: Users },
  { id: "project", label: "Project", icon: FolderOpen },
  { id: "machine", label: "Machine", icon: Monitor },
] as const;
type Grouping = (typeof GROUPINGS)[number]["id"];

type Group = { key: string; label: string; lead?: ReactNode; rows: Row[] };

/** Groups keep the list's order (most recent first), so the group with the latest work leads */
function groupRows(rows: Row[], by: Grouping): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const g =
      by === "day"
        ? dayOf(r.lastTs)
        : by === "person"
          ? { key: r.person?.id ?? "-", label: r.person?.name ?? "Unknown person" }
          : by === "project"
            ? { key: r.project, label: r.project }
            : { key: r.machine ?? "-", label: r.machine ?? "Unknown machine" };
    const found = groups.get(g.key);
    if (found) found.rows.push(r);
    else
      groups.set(g.key, {
        ...g,
        rows: [r],
        lead:
          by === "person" && r.person ? (
            <Initials name={r.person.name} />
          ) : by === "project" ? (
            <FolderOpen size={14} aria-hidden="true" />
          ) : by === "machine" ? (
            <Monitor size={14} aria-hidden="true" />
          ) : undefined,
      });
  }
  return [...groups.values()];
}

/* ---------- Toolbar ---------- */

type Filters = { people: string[]; harnesses: string[]; statuses: StatusId[] };
const NO_FILTERS: Filters = { people: [], harnesses: [], statuses: [] };
const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function Facet({
  label,
  icon: Icon,
  chosen,
  items,
}: {
  label: string;
  icon: typeof User;
  /** What is picked, in words – shown on the button in place of the label's count */
  chosen: string[];
  items: DropdownMenuItem[];
}) {
  const on = chosen.length > 0;
  return (
    <DropdownMenu
      align="start"
      title={label}
      items={items}
      trigger={({ toggle: open, triggerProps }) => (
        <button type="button" data-slot="h1-facet" className="h1-btn" data-on={on || undefined} {...triggerProps} onClick={open}>
          <Icon size={14} aria-hidden="true" />
          <span>{on ? (chosen.length === 1 ? chosen[0] : `${label} · ${chosen.length}`) : label}</span>
          <ChevronDown size={14} aria-hidden="true" className="h1-btn__chev" />
        </button>
      )}
    />
  );
}

function Toolbar({
  rows,
  query,
  onQuery,
  filters,
  onFilters,
  grouping,
  onGrouping,
}: {
  rows: Row[];
  query: string;
  onQuery: (q: string) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  grouping: Grouping;
  onGrouping: (g: Grouping) => void;
}) {
  const people = [...new Map(rows.flatMap((r) => (r.person ? [[r.person.id, r.person]] : []))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const harnesses = [...new Set(rows.map((r) => r.source))];
  const count = (pred: (r: Row) => boolean) => String(rows.filter(pred).length);
  const any = query !== "" || filters.people.length + filters.harnesses.length + filters.statuses.length > 0;
  const current = GROUPINGS.find((g) => g.id === grouping)!;
  return (
    <div className="h1-toolbar" role="search">
      <label className="h1-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search sessions"
          aria-label="Search sessions by title, summary or agent"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onQuery("")}
        />
      </label>
      <Facet
        label="Person"
        icon={User}
        chosen={people.filter((p) => filters.people.includes(p.id)).map((p) => p.name.split(" ")[0]!)}
        items={people.map((p) => ({
          label: p.name,
          icon: <Initials name={p.name} />,
          type: "checkbox",
          keepOpen: true,
          checked: filters.people.includes(p.id),
          shortcut: count((r) => r.person?.id === p.id),
          onSelect: () => onFilters({ ...filters, people: toggle(filters.people, p.id) }),
        }))}
      />
      <Facet
        label="Harness"
        icon={SquareTerminal}
        chosen={harnesses.filter((h) => filters.harnesses.includes(h)).map(harnessName)}
        items={harnesses.map((h) => ({
          label: harnessName(h),
          logo: <HarnessLogo source={h} />,
          type: "checkbox",
          keepOpen: true,
          checked: filters.harnesses.includes(h),
          shortcut: count((r) => r.source === h),
          onSelect: () => onFilters({ ...filters, harnesses: toggle(filters.harnesses, h) }),
        }))}
      />
      <Facet
        label="Status"
        icon={CircleDot}
        chosen={filters.statuses.map((s) => STATUS_LABELS[s])}
        items={(["active", "paused", "finished"] as const).map((s) => ({
          label: STATUS_LABELS[s],
          icon: <span className="h1-dot" data-status={s} aria-hidden="true" />,
          type: "checkbox",
          keepOpen: true,
          checked: filters.statuses.includes(s),
          shortcut: count((r) => statusOf(r) === s),
          onSelect: () => onFilters({ ...filters, statuses: toggle(filters.statuses, s) }),
        }))}
      />
      {any && (
        <button
          type="button"
          data-slot="h1-clear"
          className="h1-btn h1-btn--quiet"
          onClick={() => {
            onQuery("");
            onFilters(NO_FILTERS);
          }}
        >
          <X size={14} aria-hidden="true" />
          Clear
        </button>
      )}
      <span className="h1-toolbar__gap" />
      <DropdownMenu
        align="end"
        title="Group by"
        items={GROUPINGS.map((g) => ({ label: g.label, icon: g.icon, checked: g.id === grouping, onSelect: () => onGrouping(g.id) }))}
        trigger={({ toggle: open, triggerProps }) => (
          <button type="button" data-slot="h1-group" className="h1-btn h1-btn--quiet" {...triggerProps} onClick={open}>
            <Layers size={14} aria-hidden="true" />
            <span className="h1-btn__muted">Group by</span>
            <span>{current.label}</span>
            <ChevronDown size={14} aria-hidden="true" className="h1-btn__chev" />
          </button>
        )}
      />
    </div>
  );
}

/* ---------- The list ---------- */

function SessionLine({ r, picked, onOpen }: { r: Row; picked: boolean; onOpen: () => void }) {
  const status = statusOf(r);
  return (
    <li>
      <button type="button" data-slot="h1-row" className="h1-row" aria-pressed={picked} onClick={onOpen}>
        <span className="h1-who">
          {r.person ? (
            <span className="h1-tip" data-tip={r.person.name}>
              <Initials name={r.person.name} />
            </span>
          ) : (
            <span className="h1-tip" data-tip="Unknown person">
              <span className="o-initials">?</span>
            </span>
          )}
          <span className="h1-tip h1-who__harness" data-tip={harnessName(r.source)}>
            <HarnessLogo source={r.source} />
          </span>
        </span>
        <span className="h1-row__title">{r.title}</span>
        <span className="h1-row__end">
          <span className="h1-tag" data-status={status}>
            {STATUS_LABELS[status]}
          </span>
          <span className="h1-row__time">{ago(r.lastTs, fixtureClock)}</span>
        </span>
        <span className={`h1-row__summary${r.summary ? "" : " h1-row__summary--none"}`}>{r.summary ?? "No summary yet"}</span>
        <span className="h1-row__where">
          <span>@{r.agent}</span>
          {r.machine && <span className="h1-row__machine">· {r.machine}</span>}
        </span>
      </button>
    </li>
  );
}

function GroupBlock({ group, pick, onPick, live }: { group: Group; pick: Pick | null; onPick: (p: Pick) => void; live?: boolean }) {
  return (
    <section className="h1-group" aria-label={group.label}>
      <h3 className="h1-group__head">
        {live ? <span className="h1-dot" data-status="active" aria-hidden="true" /> : group.lead}
        <span>{group.label}</span>
        <span className="h1-group__count">{group.rows.length}</span>
      </h3>
      <ul className="h1-list">
        {group.rows.map((r) => (
          <SessionLine
            key={r.id}
            r={r}
            picked={pick?.kind === "session" && pick.id === r.id}
            onOpen={() => onPick({ kind: "session", id: r.id, from: null })}
          />
        ))}
      </ul>
    </section>
  );
}

function matches(r: Row, query: string, f: Filters) {
  if (f.people.length && !(r.person && f.people.includes(r.person.id))) return false;
  if (f.harnesses.length && !f.harnesses.includes(r.source)) return false;
  if (f.statuses.length && !f.statuses.includes(statusOf(r))) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.title, r.summary ?? "", r.agent, `@${r.agent}`].some((t) => t.toLowerCase().includes(q));
}

/** The Sessions page's list view: toolbar (search, facets, group by), Running now, then the groups */
export function ListView({ data, pick, onPick }: { data: Overview; pick: Pick | null; onPick: (p: Pick) => void }) {
  const rows = useMemo(() => rowsOf(data), [data]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [grouping, setGrouping] = useState<Grouping>("day");
  const shown = rows.filter((r) => matches(r, query, filters));
  const running = shown.filter((r) => statusOf(r) === "active");
  const rest = groupRows(
    shown.filter((r) => statusOf(r) !== "active"),
    grouping,
  );
  return (
    <>
      <div className="h1-body">
        <Toolbar
          rows={rows}
          query={query}
          onQuery={setQuery}
          filters={filters}
          onFilters={setFilters}
          grouping={grouping}
          onGrouping={setGrouping}
        />
        {shown.length === 0 ? (
          <div className="h1-empty">
            <Search size={16} aria-hidden="true" />
            <p className="h1-empty__title">{query.trim() ? `No sessions match “${query.trim()}”` : "No sessions match these filters"}</p>
            <p className="o2-muted">Try another word, or search all of {periodWord(data)}'s sessions.</p>
            <button
              type="button"
              data-slot="h1-clear"
              className="h1-btn"
              onClick={() => {
                setQuery("");
                setFilters(NO_FILTERS);
              }}
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <div className="h1-groups">
            {running.length > 0 && <GroupBlock live group={{ key: "running", label: "Running now", rows: running }} pick={pick} onPick={onPick} />}
            {rest.map((g) => (
              <GroupBlock key={g.key} group={g} pick={pick} onPick={onPick} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
