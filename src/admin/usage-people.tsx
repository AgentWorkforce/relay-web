import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Users2 } from "lucide-react";
import { adminApi, ApiError } from "./api";
import type {
  UsagePeople,
  UsagePerson,
  UsagePersonSession,
  UsagePersonSessions,
} from "./contracts";
import { message, useLoad } from "./use-load";
import {
  UsageRangePicker,
  UsageRefused,
  usageHash,
  rangeHash,
  useReloadOnChange,
  useRoutedDays,
  type UsageRange,
} from "./usage";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "../shell/ui";
import { HarnessIcon } from "../sessions/harness-icon";
import { onLinkClick, sessionHref } from "../sessions/route";

/** The drill-down for one member, keeping the selected period. */
const personBase = (userId: string) =>
  `#/settings/usage/people/${encodeURIComponent(userId)}`;

export function usagePersonHash(userId: string, days: UsageRange) {
  return rangeHash(personBase(userId), days);
}

/**
 * useLoad for a period-scoped request: reloads when `days` changes and only
 * returns a response for the selected period (never another period's data).
 */
function useRangeLoad<T extends { range: { days: number } }>(
  days: UsageRange,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const loaded = useLoad(load);
  const { reload } = loaded;
  useReloadOnChange(days, reload);
  const data = loaded.data?.range.days === days ? loaded.data : null;
  return { data, error: loaded.error, reload };
}

function refusal(error: Error | null) {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  return (
    <UsageRefused
      reason={error.code === "feature_not_enabled" ? "people-disabled" : "owner"}
    />
  );
}

function personName(person: { name: string | null; email: string | null }) {
  return person.name || person.email || "Unknown member";
}

function formatTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const count = (value: number | null) =>
  value === null ? "n/a" : value.toLocaleString();

function lastActive(member: UsagePerson) {
  return member.lastActiveAt ?? member.lastSessionAt;
}

type SortColumn =
  | "name"
  | "email"
  | "role"
  | "sessionsUploaded"
  | "searches"
  | "lastActive"
  | "topProjects";
type Sort = { column: SortColumn; direction: "ascending" | "descending" };

const COLUMNS: ReadonlyArray<{ id: SortColumn; label: string; numeric?: boolean }> = [
  { id: "name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "role", label: "Role" },
  { id: "sessionsUploaded", label: "Sessions uploaded", numeric: true },
  { id: "searches", label: "Searches", numeric: true },
  { id: "lastActive", label: "Last active", numeric: true },
  { id: "topProjects", label: "Top projects" },
];

function sortValue(member: UsagePerson, column: SortColumn): string | number | null {
  switch (column) {
    case "name":
      return personName(member).toLowerCase();
    case "email":
      return member.email?.toLowerCase() ?? null;
    case "role":
      return member.role;
    case "sessionsUploaded":
      return member.sessionsUploaded;
    case "searches":
      return member.searches;
    case "lastActive": {
      const time = Date.parse(lastActive(member) ?? "");
      return Number.isFinite(time) ? time : null;
    }
    case "topProjects":
      return member.topProjects[0]?.name.toLowerCase() ?? null;
  }
}

function sortMembers(members: UsagePerson[], sort: Sort) {
  const sign = sort.direction === "ascending" ? 1 : -1;
  return [...members].sort((a, b) => {
    const left = sortValue(a, sort.column);
    const right = sortValue(b, sort.column);
    // Unknown values sort last whichever way the column runs.
    if (left === null || right === null)
      return left === right ? 0 : left === null ? 1 : -1;
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return (
      order * sign ||
      personName(a).localeCompare(personName(b))
    );
  });
}

/** Per-member usage for the selected period (owner-only, `usage_people`). */
export function PeopleSection({
  organizationId,
  days,
}: {
  organizationId: string;
  days: UsageRange;
}) {
  const { data, error, reload } = useRangeLoad(days, (signal) =>
    adminApi.usagePeople(organizationId, days, signal),
  );
  const [sort, setSort] = useState<Sort>({
    column: "sessionsUploaded",
    direction: "descending",
  });

  const refused = refusal(error);
  return (
    <section aria-labelledby="usage-people-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-people-heading" className="text-base font-semibold">
          People
        </h2>
        {data && (
          <p className="text-xs text-muted-foreground">
            {data.range.from} – {data.range.to}
          </p>
        )}
      </div>
      {refused}
      {error && !refused && (
        <p role="alert">
          {message(error)}{" "}
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </p>
      )}
      {!data && !error && (
        <div role="status" aria-label="Loading people…">
          <span className="sr-only">Loading people…</span>
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {data && <PeopleTable people={data} days={days} sort={sort} onSort={setSort} />}
    </section>
  );
}

function PeopleTable({
  people,
  days,
  sort,
  onSort,
}: {
  people: UsagePeople;
  days: UsageRange;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const sessionsUnavailable = people.unavailable.includes("sessionsUploaded");
  const members = sortMembers(
    people.members.map((member) =>
      sessionsUnavailable ? { ...member, sessionsUploaded: null } : member,
    ),
    sort,
  );
  // Unknown (null) counts are not zero, and search-only activity still shows.
  const empty = members.every(
    (member) => member.sessionsUploaded === 0 && member.searches === 0,
  );
  if (empty)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia>
            <Users2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No sessions in this period</EmptyTitle>
          <EmptyDescription>
            Members appear here once they upload sessions.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const toggle = (column: SortColumn, numeric?: boolean) =>
    onSort({
      column,
      direction:
        sort.column === column
          ? sort.direction === "ascending"
            ? "descending"
            : "ascending"
          : numeric
            ? "descending"
            : "ascending",
    });
  return (
    <>
      <table aria-label="People usage" style={{ marginTop: 0 }}>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={sort.column === column.id ? sort.direction : undefined}
              >
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-1.5 max-w-full"
                  aria-label={`Sort by ${column.label}`}
                  onClick={() => toggle(column.id, column.numeric)}
                >
                  <span className="truncate">{column.label}</span>
                  {sort.column !== column.id ? (
                    <ArrowUpDown aria-hidden="true" />
                  ) : sort.direction === "ascending" ? (
                    <ArrowUp aria-hidden="true" />
                  ) : (
                    <ArrowDown aria-hidden="true" />
                  )}
                </Button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const href = usagePersonHash(member.userId, days);
            const active = formatTime(member.lastActiveAt);
            const lastSession = formatTime(member.lastSessionAt);
            return (
              <tr
                key={member.userId}
                data-testid="usage-person-row"
                className="cursor-pointer hover:bg-muted/50"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) return;
                  window.location.hash = href;
                }}
              >
                <td>
                  <a href={href} className="font-medium underline-offset-4 hover:underline">
                    {personName(member)}
                  </a>
                </td>
                <td>{member.email ?? "—"}</td>
                <td className="capitalize">{member.role}</td>
                <td className="tabular-nums">{count(member.sessionsUploaded)}</td>
                <td className="tabular-nums">{count(member.searches)}</td>
                <td>
                  {active ?? (lastSession ? (
                    <>
                      {lastSession}{" "}
                      <span className="text-xs text-muted-foreground">(last session)</span>
                    </>
                  ) : (
                    "never"
                  ))}
                </td>
                <td>
                  {member.topProjects.length
                    ? member.topProjects
                        .map((project) => `${project.name} (${project.sessions})`)
                        .join(", ")
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {people.truncated && (
        <p className="text-xs text-muted-foreground">
          Session counts are lower bounds: this period has more sessions than
          could be counted.
        </p>
      )}
      {sessionsUnavailable && (
        <p className="text-xs text-muted-foreground">
          Session counts are unavailable right now.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Searches and last active are tracked from when people usage was
        enabled.
      </p>
    </>
  );
}

/** One member's sessions in the period, newest first, with Load more. */
export function UsagePersonPage({
  organizationId,
  userId,
  workspaceId,
  initialDays = 30,
}: {
  organizationId: string;
  userId: string;
  /** The viewer's current workspace: sessions elsewhere are not linked. */
  workspaceId: string;
  initialDays?: UsageRange;
}) {
  const [days, setDays] = useRoutedDays(personBase(userId), initialDays);
  const { data, error, reload } = useRangeLoad(days, (signal) =>
    adminApi.usagePersonSessions(organizationId, userId, days, null, signal),
  );
  // Later pages belong to the first page they were loaded after.
  const [more, setMore] = useState<{
    after: UsagePersonSessions;
    sessions: UsagePersonSession[];
    nextCursor: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<Error | null>(null);
  const extra = more && more.after === data ? more : null;
  const sessions = data ? [...data.sessions, ...(extra?.sessions ?? [])] : [];
  const nextCursor = extra ? extra.nextCursor : (data?.nextCursor ?? null);
  const current = useRef(data);
  useEffect(() => {
    current.current = data;
  }, [data]);

  const choose = (next: UsageRange) => {
    setDays(next);
    setMoreError(null);
  };
  const loadMore = () => {
    if (!data || !nextCursor) return;
    const after = data;
    setLoadingMore(true);
    setMoreError(null);
    adminApi
      .usagePersonSessions(organizationId, userId, days, nextCursor)
      .then(
        (page) => {
          if (current.current !== after) return;
          setMore((previous) => ({
            after,
            sessions: [
              ...(previous?.after === after ? previous.sessions : []),
              ...page.sessions,
            ],
            nextCursor: page.nextCursor,
          }));
        },
        (failure: Error) => {
          if (current.current === after) setMoreError(failure);
        },
      )
      .finally(() => setLoadingMore(false));
  };

  const back = (
    <a href={usageHash(days)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft size={14} aria-hidden="true" />
      Back to Usage
    </a>
  );
  const refused = refusal(error);
  if (refused) return refused;
  if (error instanceof ApiError && error.status === 404)
    return (
      <div className="flex flex-col gap-4 p-6">
        {back}
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle role="alert">Person not found</EmptyTitle>
            <EmptyDescription>
              They are not a member of this organization.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );

  return (
    <div className="flex flex-col gap-6 p-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {data ? personName(data.person) : "Loading…"}
          </h2>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.person.email && <>{data.person.email} · </>}
              <span className="capitalize">{data.person.role}</span> ·{" "}
              {data.range.from} – {data.range.to}
            </p>
          )}
        </div>
        <UsageRangePicker days={days} onChange={choose} />
      </div>

      {error && (
        <p role="alert">
          {message(error)}{" "}
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </p>
      )}
      {!data && !error && (
        <div role="status" aria-label="Loading sessions…">
          <span className="sr-only">Loading sessions…</span>
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {data && data.rollup && (data.rollup.projects.length > 0 || data.rollup.titles.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="gap-2 p-4">
              <CardTitle className="text-sm">Projects</CardTitle>
              {data.rollup.projects.length ? (
                <ul aria-label="Projects" className="flex list-none flex-wrap gap-2 p-0">
                  {data.rollup.projects.map((project) => (
                    <li key={project.name}>
                      <Badge className="normal-case tracking-normal">
                        {project.name} · {project.sessions.toLocaleString()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardDescription>No projects recorded.</CardDescription>
              )}
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="gap-2 p-4">
              <CardTitle className="text-sm">Recent titles</CardTitle>
              {data.rollup.titles.length ? (
                <ul aria-label="Recent titles" className="flex flex-col gap-1 pl-4 text-sm">
                  {data.rollup.titles.map((title, index) => (
                    <li key={`${index}-${title}`}>{title}</li>
                  ))}
                </ul>
              ) : (
                <CardDescription>No titles recorded.</CardDescription>
              )}
            </CardHeader>
          </Card>
        </div>
      )}

      {data && sessions.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia>
              <Users2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No sessions for this person in this period</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      {data && sessions.length > 0 && (
        <ul aria-label="Sessions" className="flex list-none flex-col gap-2 p-0">
          {sessions.map((session) => (
            <li key={`${session.source}:${session.sessionId}`}>
              <SessionRow session={session} workspaceId={workspaceId} />
            </li>
          ))}
        </ul>
      )}

      {moreError && <p role="alert">{message(moreError)}</p>}
      {data && nextCursor && (
        <div>
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  workspaceId,
}: {
  session: UsagePersonSession;
  workspaceId: string;
}) {
  const title = session.title || "Untitled session";
  // The session viewer only opens the current workspace's sessions.
  const elsewhere = !!session.workspaceId && session.workspaceId !== workspaceId;
  const time = formatTime(session.lastTs ?? session.firstTs);
  return (
    <Card>
      <CardHeader className="gap-1 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <HarnessIcon source={session.source} className="size-4 shrink-0" />
          {elsewhere ? (
            <>
              <span className="truncate font-medium">{title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                In another workspace
              </span>
            </>
          ) : (
            <a
              href={sessionHref(
                session.sessionId,
                session.source,
                null,
                null,
                workspaceId,
              )}
              onClick={onLinkClick}
              className="truncate font-medium underline-offset-4 hover:underline"
            >
              {title}
            </a>
          )}
        </div>
        {session.summary && (
          <p className="text-sm text-muted-foreground">{session.summary}</p>
        )}
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>
            {session.source}
            {session.agentName ? ` · ${session.agentName}` : ""}
          </span>
          {session.project && <span>{session.project}</span>}
          {time && <time dateTime={session.lastTs ?? session.firstTs ?? undefined}>{time}</time>}
        </p>
      </CardHeader>
    </Card>
  );
}

