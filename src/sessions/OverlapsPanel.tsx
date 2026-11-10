import { useEffect, useMemo } from "react";
import {
  AlertTriangle,
  Boxes,
  GitBranch,
  MessageCircleOff,
} from "lucide-react";
import { SignedOut } from "../api/client";
import {
  Badge,
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Skeleton,
} from "../shell/ui";
import { dateTime, harnessName, shortProject, type Member } from "./data";
import { HarnessIcon } from "./harness-icon";
import type { OverlapFinding, OverlapsData } from "./overlaps-api";
import { filterValue, setSessionFilter } from "./query";
import { listState, onLinkClick, sessionHref } from "./route";

export const OVERLAP_RANGES = [7, 14, 30] as const;
export type OverlapRange = (typeof OVERLAP_RANGES)[number];

const KIND_LABELS: Record<OverlapFinding["kind"], string> = {
  duplicate_work: "Duplicate work",
  concurrent_edit: "Concurrent edit",
  superseded_work: "Superseded work",
  repeated_investigation: "Repeated investigation",
  stale_base: "Stale base",
};

export function overlapsWindow(days: number, now = new Date()) {
  return {
    since: new Date(now.getTime() - days * 86_400_000).toISOString(),
    until: now.toISOString(),
  };
}

export function formatUsdMicros(value: number | null): string {
  if (value === null) return "unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
}

export function formatDuplicateCost(
  usdMicros: number | null,
  tokens: number | null,
): string {
  const money = formatUsdMicros(usdMicros);
  const tokenText =
    tokens === null
      ? null
      : `${new Intl.NumberFormat("en-US").format(tokens)} tokens`;
  return [money, tokenText].filter(Boolean).join(" · ");
}

export function leadTimeText(value: number | null): string | null {
  if (value === null) return null;
  const totalMinutes = Math.max(0, Math.floor(value / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes || (!days && !hours) ? `${minutes}m` : "",
  ].filter(Boolean);
  return `Could have been flagged ${parts.join(" ")} before harm.`;
}

function memberName(members: Member[], userId: string | null) {
  if (!userId) return null;
  return members.find((member) => member.id === userId)?.name ?? null;
}

function Lane({
  lane,
  members,
  workspaceId,
  query,
}: {
  lane: OverlapFinding["lanes"][number];
  members: Member[];
  workspaceId: string;
  query: string;
}) {
  const person = memberName(members, lane.userId);
  return (
    <a
      href={sessionHref(
        lane.sessionId,
        lane.source,
        null,
        listState(query, "overlaps"),
        workspaceId,
      )}
      onClick={onLinkClick}
      className="min-w-0 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-start gap-2.5">
        <HarnessIcon source={lane.source} className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {lane.title || `${harnessName(lane.source)} session`}
          </p>
          <p className="text-xs text-muted-foreground">
            {harnessName(lane.source)}
            {person ? ` · ${person}` : ""}
          </p>
        </div>
      </div>
      {lane.branch && (
        <p className="mt-2 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <GitBranch className="size-3" aria-hidden="true" />
          {lane.branch}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {dateTime(lane.startedAt)}–{dateTime(lane.lastActionAt)}
      </p>
    </a>
  );
}

function FindingCard({
  finding,
  members,
  workspaceId,
  query,
}: {
  finding: OverlapFinding;
  members: Member[];
  workspaceId: string;
  query: string;
}) {
  const laneBySession = new Map(
    finding.lanes.map((lane) => [lane.sessionId, lane]),
  );
  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-base font-semibold text-foreground">
          {KIND_LABELS[finding.kind]}
        </h3>
        <Badge
          variant={
            finding.confidence === "high"
              ? "danger"
              : finding.confidence === "medium"
                ? "warning"
                : "default"
          }
        >
          {finding.confidence} confidence
        </Badge>
        <Badge
          variant={
            finding.communication === "not_observed" ? "warning" : "default"
          }
        >
          {finding.communication === "not_observed"
            ? "No communication observed"
            : finding.communication === "observed"
              ? "Communication observed"
              : "Communication unknown"}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {finding.explanation}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {finding.lanes.map((lane) => (
          <Lane
            key={`${lane.sessionId}:${lane.source}`}
            lane={lane}
            members={members}
            workspaceId={workspaceId}
            query={query}
          />
        ))}
      </div>
      {finding.artifacts.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Shared artifacts
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {finding.artifacts.map((artifact) => (
              <li
                key={`${artifact.type}:${artifact.value}`}
                className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground"
                title={artifact.value}
              >
                {artifact.type.replaceAll("_", " ")}: {artifact.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {leadTimeText(finding.leadTimeMs) && (
          <span className="font-medium text-foreground">
            {leadTimeText(finding.leadTimeMs)}
          </span>
        )}
        <span>
          Estimated cost:{" "}
          {formatDuplicateCost(
            finding.estimatedDuplicateCost.usdMicros,
            finding.estimatedDuplicateCost.tokens,
          )}
        </span>
      </div>
      {finding.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
          <span className="text-muted-foreground">Evidence</span>
          {finding.evidence.map((item) => {
            const lane = laneBySession.get(item.sessionId);
            if (!lane) return null;
            return (
              <a
                key={`${item.sessionId}:${item.eventId}`}
                href={sessionHref(
                  lane.sessionId,
                  lane.source,
                  item.eventId,
                  listState(query, "overlaps"),
                  workspaceId,
                )}
                onClick={onLinkClick}
                className="rounded-md bg-muted px-2 py-1 text-foreground hover:underline"
              >
                {item.kind} · {dateTime(item.ts)}
              </a>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function PartialCoverageNotice({
  coverage,
}: {
  coverage: OverlapsData["report"]["coverage"];
}) {
  if (coverage.status === "complete") return null;
  return (
    <div
      role="status"
      className="flex gap-3 rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-soft)] p-3 text-sm text-foreground"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]"
        aria-hidden="true"
      />
      <div>
        <p className="font-medium">
          {coverage.status === "partial" ? "Partial data" : "Coverage unknown"}
        </p>
        <p className="text-muted-foreground">
          Results cover {coverage.sessionsConsidered.toLocaleString()} sessions
          {coverage.sessionsTruncated
            ? `; ${coverage.sessionsTruncated.toLocaleString()} sessions were truncated.`
            : "."}
        </p>
        {coverage.notes.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {coverage.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function OverlapsPanel({
  workspaceId,
  query,
  onQuery,
  range,
  onRange,
  data,
  loading,
  error,
  onSignedOut,
}: {
  workspaceId: string;
  query: string;
  onQuery: (value: string) => void;
  range: OverlapRange;
  onRange: (value: OverlapRange) => void;
  data: OverlapsData | null | undefined;
  loading: boolean;
  error: Error | null;
  onSignedOut?: () => void;
}) {
  const project = filterValue(query, "project");
  const knownProjects = useMemo(
    () =>
      [
        ...new Set([
          ...(project ? [project] : []),
          ...(data
            ? data.report.findings.flatMap((finding) =>
                finding.lanes
                  .map((lane) => lane.projectId)
                  .filter((id): id is string => !!id),
              )
            : []),
        ]),
      ].sort(),
    [data, project],
  );
  useEffect(() => {
    if (error instanceof SignedOut) onSignedOut?.();
  }, [error, onSignedOut]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="min-w-52 text-xs font-medium text-muted-foreground">
          Project
          <Input
            className="mt-1"
            list="overlap-projects"
            value={project ?? ""}
            placeholder="All projects"
            onChange={(event) =>
              onQuery(
                setSessionFilter(query, "project", event.target.value || null),
              )
            }
          />
          <datalist id="overlap-projects">
            {knownProjects.map((id) => (
              <option key={id} value={id}>
                {shortProject(id)}
              </option>
            ))}
          </datalist>
        </label>
        <div
          role="group"
          aria-label="Overlap window"
          className="flex items-center gap-1"
        >
          {OVERLAP_RANGES.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={range === days}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              onClick={() => onRange(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert">
          {error instanceof SignedOut
            ? "Taking you to sign in…"
            : error.message}
        </p>
      )}
      {loading && !data && !error && (
        <div role="status" aria-label="Loading overlaps…" className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Findings</p>
              <p className="mt-1 text-2xl font-semibold">
                {data.report.summary.findingCount.toLocaleString()}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Lanes involved</p>
              <p className="mt-1 text-2xl font-semibold">
                {data.report.summary.lanesInvolved.toLocaleString()}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Findings by kind</p>
              <p className="mt-1 text-sm font-medium">
                {Object.entries(data.report.summary.byKind)
                  .map(
                    ([kind, count]) =>
                      `${KIND_LABELS[kind as OverlapFinding["kind"]] ?? kind}: ${count}`,
                  )
                  .join(" · ") || "None"}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">
                Estimated duplicated cost
              </p>
              <p className="mt-1 text-sm font-medium">
                {formatDuplicateCost(
                  data.report.summary.estimatedDuplicateCostUsdMicros,
                  data.report.summary.estimatedDuplicateTokens,
                )}
              </p>
            </Card>
          </div>
          <PartialCoverageNotice coverage={data.report.coverage} />
          {data.report.findings.length === 0 ? (
            <Empty className="border border-dashed border-border">
              <EmptyHeader>
                <EmptyMedia>
                  <Boxes aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No overlaps found</EmptyTitle>
                <EmptyDescription>
                  No overlaps were found in this window.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {data.report.findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  members={data.members}
                  workspaceId={workspaceId}
                  query={query}
                />
              ))}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircleOff className="size-3.5" aria-hidden="true" />
            Findings identify work that overlapped without observed
            communication.
          </p>
        </>
      )}
    </div>
  );
}
