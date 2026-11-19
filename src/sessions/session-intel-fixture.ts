// Synthetic `session-intel-workspace/1` responses for tests: fake ids only.
import type { SessionIntelResponse } from "./session-intel-api";

export const SESSION_INTEL_NOW = Date.parse("2026-10-01T12:00:00.000Z");

const ref = (source: string, sessionId: string) => ({ source, sessionId });

export const sessionIntelFixture: SessionIntelResponse = {
  contract: "session-intel-workspace/1",
  alerts: [
    {
      advisoryId: "fake-advisory-overlap",
      urgency: "low",
      kind: "nearby_work",
      class: "overlap",
      artifact: "src/example-nearby.ts",
      sessions: [ref("codex", "fake-session-a"), ref("claude", "fake-session-b")],
      createdAt: "2026-10-01T11:50:00.000Z",
      deliveredAt: null,
      acked: [{ ...ref("codex", "fake-session-a"), acked: false }],
      evidence: [],
    },
    {
      advisoryId: "fake-advisory-collision",
      urgency: "high",
      kind: "duplicate_work",
      class: "collision",
      artifact: "migrations/0001_fake.sql",
      sessions: [ref("codex", "fake-session-a"), ref("claude", "fake-session-b")],
      createdAt: "2026-10-01T11:40:00.000Z",
      deliveredAt: "2026-10-01T11:41:00.000Z",
      acked: [
        { ...ref("codex", "fake-session-a"), acked: true },
        { ...ref("claude", "fake-session-b"), acked: false },
      ],
      evidence: [
        {
          sessionId: "fake-session-b",
          eventId: "fake-event-b",
          ts: "2026-10-01T11:39:00.000Z",
          kind: "tool_result",
        },
      ],
    },
    {
      advisoryId: "fake-advisory-rule",
      urgency: "high",
      kind: "constraint_violation",
      class: "constraint_violation",
      artifact: "src/example-config.ts",
      sessions: [ref("claude", "fake-session-b"), ref("gemini", "fake-session-c")],
      createdAt: "2026-10-01T11:30:00.000Z",
      deliveredAt: "2026-10-01T11:31:00.000Z",
      acked: [{ ...ref("gemini", "fake-session-c"), acked: false }],
      evidence: [],
    },
    {
      advisoryId: "fake-advisory-intent",
      urgency: "high",
      kind: "intent_conflict",
      class: "intent_conflict",
      artifact: "src/example-schema.ts",
      sessions: [ref("codex", "fake-session-a"), ref("gemini", "fake-session-c")],
      createdAt: "2026-10-01T11:20:00.000Z",
      deliveredAt: null,
      acked: [{ ...ref("codex", "fake-session-a"), acked: false }],
      evidence: [],
    },
  ],
  status: [
    {
      source: "codex",
      sessionId: "fake-session-a",
      projectId: "example/project",
      title: "Build the fake parser",
      shortSummary: "Adds a parser for the synthetic format.",
      summaryAt: "2026-10-01T11:55:00.000Z",
      state: "active",
      lastActivityAt: "2026-10-01T11:58:00.000Z",
      openIntents: ["Ship the fake parser"],
      hasClaims: true,
    },
    {
      source: "claude",
      sessionId: "fake-session-b",
      projectId: null,
      title: null,
      shortSummary: null,
      summaryAt: null,
      state: "idle",
      lastActivityAt: "2026-10-01T11:00:00.000Z",
      openIntents: [],
      hasClaims: null,
    },
  ],
  handoffs: [
    {
      source: "gemini",
      sessionId: "fake-session-c",
      title: "Update the fake schema",
      shortSummary: "Moved the synthetic schema to version two.",
      summaryAt: "2026-09-30T16:00:00.000Z",
      state: "done",
      lastActivityAt: "2026-09-30T16:05:00.000Z",
      decisions: ["Keep version one readable"],
      openIntents: ["Remove version one later"],
      hasClaims: true,
    },
  ],
  coverage: {
    sessionsActive: 2,
    sessionsWithSummary: 1,
    sessionsWithClaims: null,
    claimsNewestAt: null,
    summariesNewestAt: "2026-10-01T11:55:00.000Z",
    claimsExtraction: "unknown",
    notes: [
      "claims unavailable",
      "handoff search is not served here; use GET /v1/sessions/summaries/search",
    ],
  },
  nextCursor: null,
};

export const emptySessionIntelFixture: SessionIntelResponse = {
  contract: "session-intel-workspace/1",
  alerts: [],
  status: [],
  handoffs: [],
  coverage: {
    sessionsActive: 0,
    sessionsWithSummary: 0,
    sessionsWithClaims: 0,
    claimsNewestAt: null,
    summariesNewestAt: null,
    claimsExtraction: "off",
    notes: [
      "handoff search is not served here; use GET /v1/sessions/summaries/search",
    ],
  },
  nextCursor: null,
};
