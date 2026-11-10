import type { OverlapsResponse } from "./overlaps-api";

const lane = (
  sessionId: string,
  source: string,
  role: "first" | "second",
  title: string,
) => ({
  sessionId,
  source,
  userId: role === "first" ? "fake-user-one" : "fake-user-two",
  projectId: "example/project",
  branch: role === "first" ? "feature/one" : "feature/two",
  title,
  startedAt: "2026-10-01T10:00:00.000Z",
  lastActionAt: "2026-10-01T10:20:00.000Z",
  role,
});

export const overlapsFixture: OverlapsResponse = {
  contract: "coordination-overlaps/1",
  window: {
    since: "2026-09-24T12:00:00.000Z",
    until: "2026-10-01T12:00:00.000Z",
  },
  generatedAt: "2026-10-01T12:00:01.000Z",
  detector: {
    name: "synthetic-test-detector",
    version: "1.0.0-test",
    paramsHash: "fake-params-hash",
  },
  coverage: {
    status: "partial",
    sessionsConsidered: 8,
    sessionsTruncated: 1,
    notes: ["Two synthetic sessions ended before their uploads completed."],
  },
  summary: {
    findingCount: 2,
    lanesInvolved: 4,
    byKind: { duplicate_work: 1, stale_base: 1 },
    estimatedDuplicateCostUsdMicros: 12_345_678,
    estimatedDuplicateTokens: 4_200,
  },
  findings: [
    {
      id: "fake-finding-first",
      kind: "duplicate_work",
      score: 0.91,
      confidence: "high",
      lanes: [
        lane("fake-session-a", "codex", "first", "Build the fake parser"),
        lane("fake-session-b", "claude", "second", "Implement the fake parser"),
      ],
      artifacts: [
        {
          type: "file",
          value: "src/example-parser.ts",
          firstTouchedAt: {
            "fake-session-a": "2026-10-01T10:03:00.000Z",
            "fake-session-b": "2026-10-01T10:05:00.000Z",
          },
        },
      ],
      alertAt: "2026-10-01T10:05:00.000Z",
      harmAt: "2026-10-01T10:17:00.000Z",
      leadTimeMs: 720_000,
      communication: "not_observed",
      estimatedDuplicateCost: {
        usdMicros: 10_000_000,
        tokens: 3_000,
        basis: "Synthetic token estimate",
      },
      evidence: [
        {
          sessionId: "fake-session-a",
          eventId: "fake-event-a",
          ts: "2026-10-01T10:03:00.000Z",
          kind: "file_edit",
        },
      ],
      explanation:
        "Both synthetic sessions implemented the same parser without communicating.",
    },
    {
      id: "fake-finding-second",
      kind: "stale_base",
      score: 0.72,
      confidence: "medium",
      lanes: [
        lane("fake-session-c", "gemini", "first", "Update the fake schema"),
        lane("fake-session-d", "cursor", "second", "Use the fake schema"),
      ],
      artifacts: [],
      alertAt: "2026-10-01T11:05:00.000Z",
      harmAt: null,
      leadTimeMs: null,
      communication: "unknown",
      estimatedDuplicateCost: {
        usdMicros: null,
        tokens: null,
        basis: "No synthetic usage metrics",
      },
      evidence: [],
      explanation:
        "The second synthetic session used an older schema revision.",
    },
  ],
};
