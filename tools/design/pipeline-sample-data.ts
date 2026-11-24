import cohortText from "./fixtures/synthesis/cohort.json?raw";
import synthesisText from "./fixtures/synthesis/expected-synthesis.json?raw";
import schemaText from "./fixtures/synthesis/schema.json?raw";
import provenanceText from "./fixtures/synthesis/provenance.json?raw";
import cohort from "./fixtures/synthesis/cohort.json";
import synthesis from "./fixtures/synthesis/expected-synthesis.json";
import schema from "./fixtures/synthesis/schema.json";
import provenance from "./fixtures/synthesis/provenance.json";
import synthesisV2 from "./fixtures/synthesis/expected-synthesis-v2.json";
import synthesisV2Text from "./fixtures/synthesis/expected-synthesis-v2.json?raw";
import stage2ReplyText from "./fixtures/synthesis/stage2-reply.json?raw";
import stage2InputText from "./fixtures/synthesis/expected-stage2-input.json?raw";
import provenanceV2 from "./fixtures/synthesis/provenance-v2.json";
import provenanceV2Text from "./fixtures/synthesis/provenance-v2.json?raw";

export { cohort, synthesis, schema, provenance, synthesisV2, provenanceV2 };
export const pipelineV2Source = `${provenanceV2.repository}/blob/${provenanceV2.commit}/`;
export const pipelineV2Downloads = {
  synthesis: { text: synthesisV2Text, name: "expected-synthesis-v2.json" },
  reply: { text: stage2ReplyText, name: "stage2-reply.json" },
  input: { text: stage2InputText, name: "expected-stage2-input.json" },
  provenance: { text: provenanceV2Text, name: "provenance-v2.json" },
};
export const pipelineDownloads = {
  cohort: { text: cohortText, name: "cohort.json" },
  synthesis: { text: synthesisText, name: "expected-synthesis.json" },
  schema: { text: schemaText, name: "schema.json" },
  provenance: { text: provenanceText, name: "provenance.json" },
};
export const pipelineSource = `${provenance.repository}/blob/${provenance.commit}/`;
export type PipelineSessionRef = { source: string; sessionId: string };
type Claim = { text: string; evidenceIds: string[]; basis: string; confidence: string };
export type PipelineReference = {
  id: string; source: string; sessionId: string; kind: string; at: string | null;
  summary: string; detail: string | null; truncated: boolean;
  locator: { eventUid: string | null; toolUseId: string | null; fileEditId: number | null };
};
export type PipelineAnalysis = {
  source: string; sessionId: string; title: string; analyzedAt: string;
  understanding: { intents: Claim[]; decisions: Claim[]; blockers: Claim[]; outcomes: Array<{ id: string; status: string; assessment: Claim; verification: { value: string; explanation: string } }> };
  evidence: { references: PipelineReference[] };
};
// Projection of a pinned, source-decoder-tested synthetic fixture. This is not
// a backend decoder. Only sessions included in the validated output can open.
export function pipelineAnalysis(ref: PipelineSessionRef): PipelineAnalysis | null {
  const included = synthesis.categories.some(category => category.sessions.some(session => session.source === ref.source && session.sessionId === ref.sessionId));
  if (!included) return null;
  const entries = cohort.sessions as unknown as Array<PipelineSessionRef & { workspace: string; status: string; result?: { analysis?: PipelineAnalysis } | null }>;
  const entry = entries.find(session => session.workspace === synthesis.workspace && session.status === "analyzed" && session.source === ref.source && session.sessionId === ref.sessionId);
  const analysis = entry?.result?.analysis;
  return analysis?.source === ref.source && analysis.sessionId === ref.sessionId ? analysis : null;
}
export function pipelineReference(ref: PipelineSessionRef, eventId: string) {
  return pipelineAnalysis(ref)?.evidence.references.find(item => item.id === eventId) ?? null;
}
// Stage 2 cites local claim titles (b1/o1/etc.), not transcript event IDs.
export function pipelineTitleClaim(ref: PipelineSessionRef, titleRef: string): Claim | null {
  if (!synthesisV2.stage2.sessions.some(session => session.source === ref.source && session.sessionId === ref.sessionId)) return null;
  const match = /^([idbo])([1-9][0-9]{0,2})$/.exec(titleRef);
  const analysis = pipelineAnalysis(ref);
  if (!match || !analysis) return null;
  const index = Number(match[2]) - 1;
  const claims = { i: analysis.understanding.intents, d: analysis.understanding.decisions, b: analysis.understanding.blockers, o: analysis.understanding.outcomes.map(outcome => outcome.assessment) };
  return claims[match[1] as keyof typeof claims][index] ?? null;
}
