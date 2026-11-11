import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { adminApi, ApiError } from "./api";
import type { Usage, UsageMetric } from "./contracts";
import { message, useLoad } from "./use-load";
import {
  Button,
  Card,
  CardContent,
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
import { cn } from "../shell/cn";

export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

const METRICS: ReadonlyArray<{ id: UsageMetric; label: string }> = [
  { id: "activeUsers", label: "Active users" },
  { id: "sessionsUploaded", label: "Sessions uploaded" },
  { id: "searches", label: "Searches" },
  { id: "summaries", label: "Summaries generated" },
];

export const OWNER_ONLY = "Only organization owners can view usage";
const NOT_ENABLED = "Usage is not enabled on this installation";
const SUMMARIES_NOTE = "Summary counts need a newer sessions pipeline";

/** Shown instead of the page when the route is refused before any request. */
export function UsageRefused({
  reason,
  onRetry,
}: {
  reason: "owner" | "disabled" | "unchecked";
  onRetry?: () => void;
}) {
  return (
    <div className="p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia>
            <BarChart3 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle role="alert">
            {reason === "owner"
              ? OWNER_ONLY
              : reason === "disabled"
                ? NOT_ENABLED
                : "We couldn’t check whether usage is enabled"}
          </EmptyTitle>
        </EmptyHeader>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Empty>
    </div>
  );
}

const count = (value: number | null) =>
  value === null ? "n/a" : value.toLocaleString();

/** Organization usage counts (owner-only). Never shows who did what. */
export function UsageSection({ organizationId }: { organizationId: string }) {
  const [days, setDays] = useState<UsageRange>(30);
  const loaded = useLoad((signal) =>
    adminApi.usage(organizationId, days, signal),
  );
  const { error, reload } = loaded;
  // useLoad keeps the last response across reloads: never show another
  // period's counts under the selected one.
  const data = loaded.data?.range.days === days ? loaded.data : null;
  const choose = (next: UsageRange) => {
    if (next === days) return;
    setDays(next);
    reload();
  };

  if (error instanceof ApiError && error.status === 403)
    return (
      <UsageRefused
        reason={error.code === "feature_not_enabled" ? "disabled" : "owner"}
      />
    );

  const summariesUnavailable =
    !!data &&
    (data.totals.summaries === null || data.unavailable.includes("summaries"));
  // An unavailable (null) metric is unknown, not zero: never call that empty.
  const empty =
    !!data &&
    data.unavailable.length === 0 &&
    METRICS.every(({ id }) => data.totals[id] === 0) &&
    data.days.every((day) => METRICS.every(({ id }) => !day[id]));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Usage period"
          className="inline-flex rounded-md border border-[var(--border-default)] p-0.5"
        >
          {USAGE_RANGES.map((range) => (
            <Button
              key={range}
              size="sm"
              variant={range === days ? "secondary" : "ghost"}
              aria-pressed={range === days}
              onClick={() => choose(range)}
            >
              {range} days
            </Button>
          ))}
        </div>
        {data && (
          <p className="text-xs text-muted-foreground">
            {data.range.from} – {data.range.to}
          </p>
        )}
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
        <div role="status" aria-label="Loading usage…" className="grid gap-4 md:grid-cols-4">
          <span className="sr-only">Loading usage…</span>
          {METRICS.map(({ id }) => (
            <Skeleton key={id} className="h-24 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <ul
            aria-label="Usage totals"
            className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-4"
          >
            {METRICS.map(({ id, label }) => {
              const value =
                id === "summaries" && summariesUnavailable
                  ? null
                  : data.totals[id];
              return (
                <li key={id}>
                  <Card className="h-full">
                    <CardHeader className="gap-1 p-4">
                      <CardDescription>{label}</CardDescription>
                      <CardTitle
                        className="text-2xl tabular-nums"
                        data-testid={`usage-total-${id}`}
                      >
                        {count(value)}
                      </CardTitle>
                      {value === null && (
                        <p className="text-xs text-muted-foreground">
                          {SUMMARIES_NOTE}
                        </p>
                      )}
                    </CardHeader>
                  </Card>
                </li>
              );
            })}
          </ul>

          {empty ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia>
                  <BarChart3 aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No usage recorded in this period</EmptyTitle>
                <EmptyDescription>
                  Counts appear here as your organization uploads, searches and
                  summarizes sessions.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {METRICS.map(({ id, label }) =>
                id === "summaries" && summariesUnavailable ? (
                  <Card key={id}>
                    <CardHeader className="p-4">
                      <CardTitle className="text-sm">{label} per day</CardTitle>
                      <CardDescription>{SUMMARIES_NOTE}</CardDescription>
                    </CardHeader>
                  </Card>
                ) : (
                  <DailyChart key={id} metric={id} label={label} usage={data} />
                ),
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Searches and active users are counted from when usage tracking was
            enabled.
          </p>
        </>
      )}
    </div>
  );
}

const HEIGHT = 40;

/** Plain SVG bars, one per day, oldest first. */
function DailyChart({
  metric,
  label,
  usage,
}: {
  metric: UsageMetric;
  label: string;
  usage: Usage;
}) {
  const values = usage.days.map((day) => day[metric] ?? 0);
  const peak = Math.max(0, ...values);
  const scale = Math.max(1, peak);
  const slots = Math.max(1, values.length);
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between p-4 pb-2">
        <CardTitle className="text-sm">{label} per day</CardTitle>
        <CardDescription className="text-xs tabular-nums">
          Peak {peak.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <svg
          role="img"
          aria-label={`${label} per day over the last ${usage.range.days} days, peak ${peak}`}
          viewBox={`0 0 ${slots} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-24 w-full"
        >
          <line
            x1={0}
            x2={slots}
            y1={HEIGHT}
            y2={HEIGHT}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--border-default)" }}
          />
          {usage.days.map((day, index) => {
            const value = values[index]!;
            const height = (value / scale) * HEIGHT;
            return (
              <rect
                key={day.date}
                x={index + 0.15}
                width={0.7}
                y={HEIGHT - height}
                height={height}
                className={cn(value === 0 && "opacity-0")}
                style={{ fill: "var(--primary)" }}
              >
                <title>{`${day.date}: ${value.toLocaleString()}`}</title>
              </rect>
            );
          })}
        </svg>
        <div
          className="mt-1 flex justify-between text-[11px] text-muted-foreground"
          aria-hidden="true"
        >
          <span>{usage.days[0]?.date ?? usage.range.from}</span>
          <span>{usage.days.at(-1)?.date ?? usage.range.to}</span>
        </div>
      </CardContent>
    </Card>
  );
}
