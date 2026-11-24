import { dataset, fixtureClock, organization, workspace, proposedInitiatives, type ScenarioId } from "./scenarios";

// Invented classifications, using the source-owned per-session field vocabulary.
// This does not run a model or implement a production aggregation contract.
const workTypes = ["implementation", "testing", "debugging", "implementation", "implementation", "review"] as const;
const themes = [
  { id: "cache-correctness", title: "Preserve cache correctness during migration", slots: [0, 1] },
  { id: "payment-recovery", title: "Make payment processing resilient", slots: [2, 3] },
  { id: "setup-clarity", title: "Make setup and settings easier to understand", slots: [4, 5] },
];
export function operatorData(scenario: ScenarioId) {
  const records = dataset(scenario);
  const supported = scenario !== "partial";
  const current = supported && scenario !== "stale";
  const claim = (text: string, evidenceId: string, inferred = false) => ({
    text, evidenceIds: [evidenceId], confidence: "medium" as const,
    basis: inferred ? "inferred" as const : "observed" as const,
  });
  const sessions = records.map(({ row, events }, index) => ({
    sessionId: row.sessionId, source: row.source, project: row.project.name,
    userIds: row.userIds, lastActivityAt: row.lastTs,
    analyzedAt: supported ? (scenario === "stale" ? new Date(Date.parse(row.firstTs) + 500).toISOString() : row.lastTs) : null,
    analysisStatus: supported ? (current ? "current" : "stale") : "unavailable",
    // Abbreviated SessionSemanticAnalysis excerpt, not a GET /analysis response.
    understanding: supported ? {
      intents: [claim(events[0]!.content, events[0]!.eventId)],
      sessionType: { value: workTypes[index % workTypes.length]!, explanation: "Hand-authored fixture classification", evidenceIds: [events[0]!.eventId], confidence: "medium", basis: "inferred" },
      outcome: current ? claim(events[3]!.content, events[3]!.eventId) : { text: "Outcome not yet observed at this snapshot.", evidenceIds: [], confidence: "low", basis: "unknown" },
      outcomes: [{
        id: `${row.sessionId}-outcome`,
        intent: claim(events[0]!.content, events[0]!.eventId),
        status: current ? (row.workState.status === "finished" ? "reported-complete" : "in-progress") : "unknown",
        assessment: current ? claim(events[3]!.content, events[3]!.eventId) : { text: "Only the opening prompt is available at this snapshot.", evidenceIds: [events[0]!.eventId], confidence: "low", basis: "observed" },
        changes: [],
        verification: { value: "not-observed", explanation: "This excerpt does not assess verification of the complete requested outcome.", evidenceIds: [], confidence: "low", basis: "unknown" },
        remaining: [], contradictions: [], supersededBy: null,
      }],
      blockers: current && index % 6 === 1 ? [claim("Staging validation needs a hostname.", events[3]!.eventId)] : [],
    } : null,
    evidence: (current ? [events[0]!, events[3]!] : [events[0]!]).map(event => ({
      id: event.eventId, source: row.source, sessionId: row.sessionId,
      kind: event.kind === "prompt" ? "human-message" : "assistant-message",
      at: event.ts, summary: event.content,
      locator: { eventUid: event.eventId, toolUseId: null, fileEditId: null },
    })),
  }));
  const categories = [...new Set(workTypes)].map(value => ({
    value, sessionIds: sessions.filter(session => session.analysisStatus === "current" && session.understanding?.sessionType.value === value).map(session => session.sessionId),
  }));
  const tokenRows = records.filter(({row}) => row.totalInputTokens !== null && row.totalOutputTokens !== null);
  const blockerSessions = sessions.filter(session => session.analysisStatus === "current" && session.understanding?.blockers.length);
  return {
    designProposal: true,
    provenance: "Synthetic, hand-authored examples. No model or live operator endpoint is called.",
    scope: { orgId: organization.id, workspaceId: workspace.id, from: records.at(-1)?.row.firstTs ?? fixtureClock, to: fixtureClock },
    generatedAt: fixtureClock,
    coverage: {
      recordedSessions: records.length,
      currentAnalysisSessions: current ? records.length : 0,
      staleAnalysisSessions: supported && !current ? records.length : 0,
      unavailableAnalysisSessions: supported ? 0 : records.length,
      tokenSessions: tokenRows.length,
      // Fixture totals cover the complete in-memory list, including all busy pages.
      truncated: false,
    },
    statistics: {
      people: new Set(records.flatMap(({row}) => row.userIds)).size,
      projects: new Set(records.map(({row}) => row.project.name)).size,
      inputTokensObserved: tokenRows.length ? tokenRows.reduce((sum, {row}) => sum + row.totalInputTokens!, 0) : null,
      outputTokensObserved: tokenRows.length ? tokenRows.reduce((sum, {row}) => sum + row.totalOutputTokens!, 0) : null,
      costUSD: null,
      categories,
      uncategorizedSessions: current ? 0 : records.length,
    },
    initiatives: current ? proposedInitiatives.map((initiative, index) => ({
      id: `design-initiative-${index + 1}`, title: initiative.name,
      humanGoal: [
        "Move asset delivery to the edge while preserving cache behavior.",
        "Make payment events safe to retry and document recovery.",
        "Make workspace settings and first-run setup easier to use.",
      ][index]!,
      basis: "inferred", confidence: "medium", progress: initiative.progress,
      decision: initiative.decision, nextStep: initiative.nextStep,
      sessionIds: sessions.filter(session => session.project === initiative.name).map(session => session.sessionId),
      evidenceIds: sessions.filter(session => session.project === initiative.name).flatMap(session => session.evidence.map(item => item.id)),
    })).filter(initiative => initiative.sessionIds.length > 0) : [],
    themes: current ? themes.map(theme => ({
      id: theme.id, title: theme.title, basis: "inferred", confidence: "medium",
      sessionIds: sessions.filter((_, index) => theme.slots.includes(index % 6)).map(session => session.sessionId),
      evidenceIds: sessions.filter((_, index) => theme.slots.includes(index % 6)).map(session => session.evidence[0]!.id),
      kind: "work-theme", // A shared topic is not automatically a recurring failure.
    })).filter(theme => theme.sessionIds.length >= 2) : [],
    improvementOpportunities: blockerSessions.length ? [{
      id: "staging-preflight",
      observation: `${blockerSessions.length} session${blockerSessions.length === 1 ? " reports" : "s report"} staging validation waiting for a hostname.`,
      reportCount: blockerSessions.length, independentCaseCount: null,
      recommendation: "Try including staging prerequisites and a responsible contact in the migration brief.",
      basis: "inferred", confidence: "low", recurringIssue: false,
      sessionIds: blockerSessions.map(session => session.sessionId), evidenceIds: blockerSessions.flatMap(session => session.understanding!.blockers.flatMap(blocker => blocker.evidenceIds)),
      suggestedMeasure: "Compare staging-prerequisite blockers per analyzed migration session in the next equivalent window.",
      measuredImpact: null,
    }] : [],
    sessions,
  };
}
