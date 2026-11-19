// The Sessions page's Session intelligence view: a coverage strip, open alerts
// grouped by class, live status of active sessions, and recent handoffs. All
// text is rendered as text; links are built only from session and event ids.
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, BellOff, Info } from "lucide-react";
import { SignedOut } from "../api/client";
import {
  Badge,
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "../shell/ui";
import { dateTime, harnessName, sessionKey, shortSessionId } from "./data";
import { HarnessIcon } from "./harness-icon";
import { listState, onLinkClick, sessionHref } from "./route";
import type {
  SessionIntelAlert,
  SessionIntelCoverage,
  SessionIntelHandoff,
  SessionIntelResponse,
  SessionIntelStatus,
} from "./session-intel-api";
import { relativeTime } from "./visualizations/session-data";

/** Plain labels for the alert classes, in the order the groups are shown. */
export const CLASS_LABELS = {
  constraint_violation: "Rule broken",
  intent_conflict: "Conflicting decisions",
  collision: "Duplicate work",
  overlap: "Working nearby",
  planned_fleet: "Conflicting plans",
  none: "Other",
} as const;
const UNCLASSIFIED = "Unclassified";
const CLASS_ORDER = Object.keys(CLASS_LABELS);

export function alertClassLabel(value: string | null): string {
  return value !== null && Object.hasOwn(CLASS_LABELS, value)
    ? CLASS_LABELS[value as keyof typeof CLASS_LABELS]
    : UNCLASSIFIED;
}

const classRank = (value: string | null) => {
  const index = value === null ? -1 : CLASS_ORDER.indexOf(value);
  return index === -1 ? CLASS_ORDER.length : index;
};

/**
 * Alerts grouped by urgency, then class: every high alert comes before any
 * low one; within an urgency the classes run rule broken, conflicting
 * decisions, duplicate work, working nearby, conflicting plans, other, then
 * unclassified. Newest first within a group.
 */
export function groupAlerts(alerts: SessionIntelAlert[]) {
  const groups = new Map<
    string,
    { urgency: "high" | "low"; label: string; rank: number; alerts: SessionIntelAlert[] }
  >();
  for (const alert of alerts) {
    const label = alertClassLabel(alert.class);
    const key = `${alert.urgency}:${label}`;
    const group = groups.get(key) ?? {
      urgency: alert.urgency,
      label,
      rank: classRank(alert.class),
      alerts: [],
    };
    group.alerts.push(alert);
    groups.set(key, group);
  }
  const time = (alert: SessionIntelAlert) => Date.parse(alert.createdAt) || 0;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      alerts: [...group.alerts].sort((a, b) => time(b) - time(a)),
    }))
    .sort(
      (a, b) =>
        (a.urgency === "high" ? 0 : 1) - (b.urgency === "high" ? 0 : 1) ||
        a.rank - b.rank,
    );
}

const NOTE_TEXT: Record<string, string | null> = {
  "claims unavailable":
    "Claims couldn't be read, so open intents and decisions are missing.",
  "alerts capped at 100": "Only the newest 100 alerts are shown; there may be more.",
  "status capped at 200": "Only 200 active sessions are shown; there may be more.",
  "handoffs capped at 100": "Only the newest 100 handoffs are shown; there may be more.",
  "alert kind without a class":
    "Some alerts have no class yet and are listed as Unclassified.",
  // The dashboard has no summary search to link to.
  "handoff search is not served here; use GET /v1/sessions/summaries/search": null,
};

export function coverageNotes(notes: string[]): string[] {
  return notes
    .map((note) => (Object.hasOwn(NOTE_TEXT, note) ? NOTE_TEXT[note]! : note))
    .filter((note): note is string => !!note);
}

const extractionOn = (coverage: SessionIntelCoverage) =>
  coverage.claimsExtraction === "on";
const extractionLabel = (coverage: SessionIntelCoverage) =>
  coverage.claimsExtraction === "off" ? "off" : "unknown";

export function CoverageStrip({
  coverage,
  now,
}: {
  coverage: SessionIntelCoverage;
  now: number;
}) {
  const notes = coverageNotes(coverage.notes);
  const active = coverage.sessionsActive.toLocaleString();
  return (
    <section
      aria-label="Coverage"
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground"
    >
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        <li>
          Summaries: {coverage.sessionsWithSummary.toLocaleString()} of {active}{" "}
          active sessions, newest{" "}
          {coverage.summariesNewestAt
            ? relativeTime(coverage.summariesNewestAt, now)
            : "none"}
        </li>
        <li>
          Claims:{" "}
          {coverage.sessionsWithClaims === null
            ? "unavailable"
            : `${coverage.sessionsWithClaims.toLocaleString()} of ${active}`}
        </li>
        {!extractionOn(coverage) && (
          <li>Claim extraction: {extractionLabel(coverage)}</li>
        )}
      </ul>
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          This view covers only the sessions that were recorded and read, so
          it may be incomplete.
          {!extractionOn(coverage) &&
            " Rule broken and Conflicting decisions alerts depend on claim extraction."}
        </span>
      </p>
      {notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {notes.map((note, index) => (
            <li key={`${index}:${note}`}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Titles = Map<string, string | null>;

function sessionLabel(
  session: { source: string; sessionId: string },
  titles: Titles,
) {
  return (
    titles.get(sessionKey(session)) ||
    `${harnessName(session.source)} session · ${shortSessionId(session.sessionId)}`
  );
}

function SessionAnchor({
  session,
  title,
  workspaceId,
  query,
  event = null,
  children,
  className,
}: {
  session: { source: string; sessionId: string };
  title?: string;
  workspaceId: string;
  query: string;
  event?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={sessionHref(
        session.sessionId,
        session.source,
        event,
        listState(query, "intel"),
        workspaceId,
      )}
      onClick={onLinkClick}
      title={title}
      className={className}
    >
      {children}
    </a>
  );
}

function AlertCard({
  alert,
  titles,
  workspaceId,
  query,
}: {
  alert: SessionIntelAlert;
  titles: Titles;
  workspaceId: string;
  query: string;
}) {
  const bySession = new Map(
    alert.sessions.map((session) => [session.sessionId, session]),
  );
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={alert.urgency === "high" ? "danger" : "default"}>
          {alert.urgency === "high" ? "High" : "Low"}
        </Badge>
        <p
          className="min-w-0 max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground"
          title={alert.artifact}
        >
          {alert.artifact}
        </p>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {alert.sessions.map((session) => (
          <li key={sessionKey(session)} className="min-w-0">
            <SessionAnchor
              session={session}
              workspaceId={workspaceId}
              query={query}
              className="group flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-sm hover:bg-accent"
            >
              <HarnessIcon source={session.source} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {sessionLabel(session, titles)}
              </span>
              <ArrowUpRight
                className="size-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
            </SessionAnchor>
          </li>
        ))}
      </ul>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>Created</dt>
          <dd className="text-foreground">{dateTime(alert.createdAt)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Delivered</dt>
          <dd className="text-foreground">
            {alert.deliveredAt ? dateTime(alert.deliveredAt) : "not yet"}
          </dd>
        </div>
      </dl>
      {alert.acked.length > 0 && (
        <ul
          aria-label="Delivery"
          className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
        >
          {alert.acked.map((entry) => (
            <li key={sessionKey(entry)}>
              {sessionLabel(entry, titles)}:{" "}
              <span
                className={
                  entry.acked
                    ? "text-foreground"
                    : "font-medium text-[var(--status-warning)]"
                }
              >
                {entry.acked ? "acked" : "not acked"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {alert.evidence.some((item) => bySession.has(item.sessionId)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
          <span className="text-muted-foreground">Jump to evidence</span>
          {alert.evidence.map((item) => {
            const session = bySession.get(item.sessionId);
            if (!session) return null;
            return (
              <SessionAnchor
                key={`${item.sessionId}:${item.eventId}`}
                session={session}
                event={item.eventId}
                workspaceId={workspaceId}
                query={query}
                className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground hover:underline"
              >
                {item.kind.replaceAll("_", " ")} · {dateTime(item.ts)}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </SessionAnchor>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AlertsSection({
  data,
  titles,
  workspaceId,
  query,
}: {
  data: SessionIntelResponse;
  titles: Titles;
  workspaceId: string;
  query: string;
}) {
  const groups = groupAlerts(data.alerts);
  return (
    <section aria-labelledby="session-intel-alerts" className="flex flex-col gap-3">
      <h2 id="session-intel-alerts" className="text-base font-semibold text-foreground">
        Alerts
      </h2>
      {groups.length === 0 ? (
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia>
              <BellOff aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No alerts</EmptyTitle>
            <EmptyDescription>
              No open alerts in what this view could read. That doesn't mean
              there are none: see the coverage above.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((group) => (
          <div key={`${group.urgency}:${group.label}`} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">
              {group.urgency === "high" ? "High" : "Low"} · {group.label}{" "}
              <span className="text-muted-foreground">
                ({group.alerts.length.toLocaleString()})
              </span>
            </h3>
            {group.alerts.map((alert) => (
              <AlertCard
                key={alert.advisoryId}
                alert={alert}
                titles={titles}
                workspaceId={workspaceId}
                query={query}
              />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

const STATE_LABELS: Record<string, string> = {
  active: "Active",
  idle: "Idle",
  done: "Done",
  abandoned: "Abandoned",
  unknown: "Unknown",
};
const stateLabel = (state: string) => STATE_LABELS[state] ?? state;

function TitleList({
  items,
  hasClaims,
  none,
}: {
  items: string[];
  hasClaims: boolean | null;
  none: string;
}) {
  if (hasClaims === null) return <span className="text-muted-foreground">unknown</span>;
  if (items.length === 0) return <span className="text-muted-foreground">{none}</span>;
  return (
    <ul className="list-disc pl-4">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>{item}</li>
      ))}
    </ul>
  );
}

const Summary = ({ text }: { text: string | null }) =>
  text ? <>{text}</> : <span className="italic text-muted-foreground">No summary yet</span>;

function StatusSection({
  status,
  titles,
  workspaceId,
  query,
  now,
}: {
  status: SessionIntelStatus[];
  titles: Titles;
  workspaceId: string;
  query: string;
  now: number;
}) {
  return (
    <section aria-labelledby="session-intel-status" className="flex flex-col gap-3">
      <h2 id="session-intel-status" className="text-base font-semibold text-foreground">
        Live status
      </h2>
      {status.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active sessions in the last 2 hours.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">
              Active sessions, most recently active first
            </caption>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-medium">Session</th>
                <th scope="col" className="px-3 py-2 font-medium">Summary</th>
                <th scope="col" className="px-3 py-2 font-medium">State</th>
                <th scope="col" className="px-3 py-2 font-medium">Last active</th>
                <th scope="col" className="px-3 py-2 font-medium">Open intents</th>
              </tr>
            </thead>
            <tbody>
              {status.map((row) => (
                <tr key={sessionKey(row)} className="border-b border-border align-top last:border-b-0">
                  <td className="max-w-64 px-3 py-2">
                    <SessionAnchor
                      session={row}
                      workspaceId={workspaceId}
                      query={query}
                      className="flex min-w-0 items-center gap-2 font-medium text-foreground hover:underline"
                    >
                      <HarnessIcon source={row.source} className="size-4 shrink-0" />
                      <span className="truncate">{sessionLabel(row, titles)}</span>
                    </SessionAnchor>
                  </td>
                  <td className="max-w-96 px-3 py-2 text-foreground">
                    <Summary text={row.shortSummary} />
                  </td>
                  <td className="px-3 py-2">{stateLabel(row.state)}</td>
                  <td className="whitespace-nowrap px-3 py-2" title={dateTime(row.lastActivityAt)}>
                    {relativeTime(row.lastActivityAt, now)}
                  </td>
                  <td className="max-w-64 px-3 py-2">
                    <TitleList items={row.openIntents} hasClaims={row.hasClaims} none="None" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HandoffsSection({
  handoffs,
  titles,
  workspaceId,
  query,
  now,
}: {
  handoffs: SessionIntelHandoff[];
  titles: Titles;
  workspaceId: string;
  query: string;
  now: number;
}) {
  return (
    <section aria-labelledby="session-intel-handoffs" className="flex flex-col gap-3">
      <h2 id="session-intel-handoffs" className="text-base font-semibold text-foreground">
        Handoffs
      </h2>
      {handoffs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No idle or ended sessions in the last 7 days.
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {handoffs.map((row) => (
            <li key={sessionKey(row)} className="min-w-0">
              <Card className="h-full p-4">
                <SessionAnchor
                  session={row}
                  workspaceId={workspaceId}
                  query={query}
                  className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground hover:underline"
                >
                  <HarnessIcon source={row.source} className="size-4 shrink-0" />
                  <span className="truncate">{sessionLabel(row, titles)}</span>
                </SessionAnchor>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stateLabel(row.state)} ·{" "}
                  <span title={dateTime(row.lastActivityAt)}>
                    {relativeTime(row.lastActivityAt, now)}
                  </span>
                </p>
                <p className="mt-2 text-sm text-foreground">
                  <Summary text={row.shortSummary} />
                </p>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Decisions</p>
                    <TitleList items={row.decisions} hasClaims={row.hasClaims} none="None recorded" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Open intents</p>
                    <TitleList items={row.openIntents} hasClaims={row.hasClaims} none="None" />
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SessionIntelPanel({
  workspaceId,
  query,
  data,
  loading,
  error,
  onSignedOut,
  now: fixedNow,
}: {
  workspaceId: string;
  query: string;
  data: SessionIntelResponse | null | undefined;
  loading: boolean;
  error: Error | null;
  onSignedOut?: () => void;
  /** The clock for relative times (tests). */
  now?: number;
}) {
  const [openedAt] = useState(() => Date.now());
  const now = fixedNow ?? openedAt;
  useEffect(() => {
    if (error instanceof SignedOut) onSignedOut?.();
  }, [error, onSignedOut]);
  const titles: Titles = new Map(
    data
      ? [...data.status, ...data.handoffs]
          .filter((row) => row.title)
          .map((row) => [sessionKey(row), row.title])
      : [],
  );

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert">
          {error instanceof SignedOut ? "Taking you to sign in…" : error.message}
        </p>
      )}
      {loading && !data && !error && (
        <div role="status" aria-label="Loading session intelligence…" className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}
      {data && (
        <>
          <CoverageStrip coverage={data.coverage} now={now} />
          <AlertsSection data={data} titles={titles} workspaceId={workspaceId} query={query} />
          <StatusSection status={data.status} titles={titles} workspaceId={workspaceId} query={query} now={now} />
          <HandoffsSection handoffs={data.handoffs} titles={titles} workspaceId={workspaceId} query={query} now={now} />
        </>
      )}
    </div>
  );
}
