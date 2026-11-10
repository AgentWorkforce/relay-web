import { z } from "zod";
import type { Member } from "./data";
import { workspaceMembers } from "./api";
import { ReadApiUnavailable, readApiEnabled, readApiGet } from "./read-api";

const nullableString = z.string().nullable();
const laneSchema = z.object({
  sessionId: z.string(),
  source: z.string(),
  userId: nullableString,
  projectId: nullableString,
  branch: nullableString,
  title: nullableString,
  startedAt: z.string(),
  lastActionAt: z.string(),
  role: z.enum(["first", "second"]),
});
const artifactSchema = z.object({
  type: z.enum([
    "file",
    "branch",
    "task",
    "commit",
    "pull_request",
    "migration",
  ]),
  value: z.string(),
  firstTouchedAt: z.record(z.string(), z.string()),
});
const evidenceSchema = z.object({
  sessionId: z.string(),
  eventId: z.string(),
  ts: z.string(),
  kind: z.string(),
});
export const overlapFindingSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "duplicate_work",
    "concurrent_edit",
    "superseded_work",
    "repeated_investigation",
    "stale_base",
  ]),
  score: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  lanes: z.array(laneSchema).min(2),
  artifacts: z.array(artifactSchema),
  alertAt: z.string(),
  harmAt: nullableString,
  leadTimeMs: z.number().nonnegative().nullable(),
  communication: z.enum(["observed", "not_observed", "unknown"]),
  estimatedDuplicateCost: z.object({
    usdMicros: z.number().nonnegative().nullable(),
    tokens: z.number().nonnegative().nullable(),
    basis: z.string(),
  }),
  evidence: z.array(evidenceSchema),
  explanation: z.string(),
});

export const overlapsResponseSchema = z.object({
  contract: z.literal("coordination-overlaps/1"),
  window: z.object({ since: z.string(), until: z.string() }),
  generatedAt: z.string(),
  detector: z.object({
    name: z.string(),
    version: z.string(),
    paramsHash: z.string(),
  }),
  coverage: z.object({
    status: z.enum(["complete", "partial", "unknown"]),
    sessionsConsidered: z.number().nonnegative(),
    sessionsTruncated: z.number().nonnegative(),
    notes: z.array(z.string()),
  }),
  summary: z.object({
    findingCount: z.number().nonnegative(),
    lanesInvolved: z.number().nonnegative(),
    byKind: z.record(z.string(), z.number().nonnegative()),
    estimatedDuplicateCostUsdMicros: z.number().nonnegative().nullable(),
    estimatedDuplicateTokens: z.number().nonnegative().nullable(),
  }),
  findings: z.array(overlapFindingSchema),
});

export type OverlapFinding = z.infer<typeof overlapFindingSchema>;
export type OverlapsResponse = z.infer<typeof overlapsResponseSchema>;
export type OverlapsData = {
  report: OverlapsResponse;
  members: Member[];
};

export async function coordinationOverlaps(
  workspace: string,
  range: { since: string; until: string; project?: string },
  signal: AbortSignal,
): Promise<OverlapsData | null> {
  if (!readApiEnabled()) return null;
  try {
    const [body, members] = await Promise.all([
      readApiGet(
        workspace,
        "/v1/coordination/overlaps",
        {
          since: range.since,
          until: range.until,
          project: range.project,
        },
        signal,
      ),
      workspaceMembers(workspace),
    ]);
    return { report: overlapsResponseSchema.parse(body), members };
  } catch (error) {
    if (
      error instanceof ReadApiUnavailable &&
      error.reason === "read_404" &&
      error.code === "coordination_overlaps_disabled"
    )
      return null;
    throw error;
  }
}
