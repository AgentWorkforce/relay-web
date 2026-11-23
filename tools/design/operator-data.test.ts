import { expect, it } from "vitest";
import { operatorData } from "./operator-data";
import { dataset } from "./scenarios";

it("links every theme, intent and improvement to the same source session evidence", () => {
  const pack = operatorData("busy");
  const records = dataset("busy");
  const evidence = new Map(pack.sessions.flatMap(session => session.evidence.map(item => [item.id, item] as const)));
  for (const theme of pack.themes) {
    expect(theme.sessionIds.length).toBeGreaterThanOrEqual(2);
    for (const id of theme.evidenceIds) {
      const item = evidence.get(id)!;
      expect(item.kind).toBe("human-message");
      expect(theme.sessionIds).toContain(item.sessionId);
      const record = records.find(({row}) => row.sessionId === item.sessionId && row.source === item.source)!;
      expect(record.events.find(event => event.eventId === id)?.content).toBe(item.summary);
    }
  }
  for (const opportunity of pack.improvementOpportunities) {
    expect(opportunity.reportCount).toBe(5);
    expect(opportunity.sessionIds).toHaveLength(5);
    expect(opportunity.evidenceIds).toHaveLength(5);
    expect(opportunity.independentCaseCount).toBeNull();
    expect(opportunity.recurringIssue).toBe(false);
    expect(opportunity.measuredImpact).toBeNull();
    for (const id of opportunity.evidenceIds) expect(opportunity.sessionIds).toContain(evidence.get(id)?.sessionId);
  }
  expect(pack.statistics.categories.reduce((sum, category) => sum + category.sessionIds.length, 0)).toBe(30);
  expect(pack.coverage.recordedSessions).toBe(30);
  expect(pack.statistics.people).toBe(3);
  expect(pack.statistics.costUSD).toBeNull();
});

it("keeps stale, unavailable and empty analysis out of current synthesis", () => {
  for (const scenario of ["partial", "stale", "empty"] as const) {
    const pack = operatorData(scenario);
    expect(pack.coverage.currentAnalysisSessions).toBe(0);
    expect(pack.themes).toEqual([]);
    expect(pack.improvementOpportunities).toEqual([]);
    expect(pack.statistics.categories.flatMap(category => category.sessionIds)).toEqual([]);
    expect(pack.statistics.uncategorizedSessions).toBe(pack.coverage.recordedSessions);
  }
  expect(operatorData("partial").statistics.inputTokensObserved).toBeNull();
  expect(operatorData("partial").coverage.tokenSessions).toBe(0);
  expect(operatorData("stale").coverage.tokenSessions).toBe(3);
});

it("stale snapshots cite only evidence available when analysis ran", () => {
  for (const session of operatorData("stale").sessions) {
    const at = Date.parse(session.analyzedAt!);
    const evidence = new Map(session.evidence.map(item => [item.id, item]));
    expect(at).toBeLessThan(Date.parse(session.lastActivityAt));
    for (const item of session.evidence) expect(Date.parse(item.at)).toBeLessThanOrEqual(at);
    const understanding = session.understanding!;
    expect(understanding.outcomes).toHaveLength(1);
    expect(understanding.outcomes[0]!.status).toBe("unknown");
    expect(understanding.blockers).toEqual([]);
    for (const claim of [...understanding.intents, understanding.outcome, ...understanding.outcomes.flatMap(outcome => [outcome.intent, outcome.assessment])]) {
      for (const id of claim.evidenceIds) expect(Date.parse(evidence.get(id)!.at)).toBeLessThanOrEqual(at);
    }
  }
});
