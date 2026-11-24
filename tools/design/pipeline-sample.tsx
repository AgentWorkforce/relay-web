import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../../src/shell/ui";
import { synthesis, provenance, pipelineDownloads, pipelineSource, pipelineAnalysis, pipelineReference, synthesisV2, pipelineV2Downloads, pipelineV2Source, pipelineTitleClaim, type PipelineSessionRef } from "./pipeline-sample-data";

export function PipelineSample({ onDownload }: { onDownload: (value: unknown, name: string, raw?: boolean) => void }) {
  const [bucket, setBucket] = useState("");
  const [selected, setSelected] = useState<(PipelineSessionRef & { eventId?: string; titleRef?: string }) | null>(null);
  const category = synthesis.categories.find(item => `${item.sessionType}/${item.outcomeStatus}` === bucket);
  const analysis = selected ? pipelineAnalysis(selected) : null;
  const reference = selected?.eventId ? pipelineReference(selected, selected.eventId) : null;
  const titleClaim = selected?.titleRef ? pipelineTitleClaim(selected, selected.titleRef) : null;
  const notProvided = synthesis.inputs.eligible - synthesis.inputs.caps.sessions.offered;
  const skipped = Object.values(synthesis.inputs.skipped).reduce((sum, count) => sum + count, 0);
  return (
    <section aria-label="Source-owned pipeline sample" className="design-project-detail">
      <div className="design-notice">
        <strong>Computed synthetic output · unlanded review commit</strong>
        <p>This frozen pipeline cohort is separate from the Northstar scenarios. Its F1 records are invented; the v1 output was computed by the source aggregator. No live read endpoint or real team data is supplied here. The separate v2 preview below uses a hand-written fake model reply.</p>
        <p><a href={`${pipelineSource}docs/session-intel-workspace-synthesis.md`} target="_blank" rel="noreferrer">Source-owned workspace-synthesis/1 contract</a> · commit <code>{provenance.commit.slice(0, 9)}</code></p>
        <p>Workspace <code>{synthesis.workspace}</code> · {synthesis.window.since} ≤ time &lt; {synthesis.window.until}. Frozen generation time: {synthesis.generatedAt}. Scenario controls do not change this sample.</p>
      </div>
      <div className="design-inline">
        <Button variant="outline" size="sm" onClick={() => onDownload(pipelineDownloads.synthesis.text, pipelineDownloads.synthesis.name, true)}>Download computed output</Button>
        <Button variant="outline" size="sm" onClick={() => onDownload(pipelineDownloads.cohort.text, pipelineDownloads.cohort.name, true)}>Download cohort and negative cases</Button>
        <Button variant="outline" size="sm" onClick={() => onDownload(pipelineDownloads.schema.text, pipelineDownloads.schema.name, true)}>Download JSON schema</Button>
        <Button variant="ghost" size="sm" onClick={() => onDownload(pipelineDownloads.provenance.text, pipelineDownloads.provenance.name, true)}>Download provenance</Button>
      </div>
      <h2>What this cohort can tell you</h2>
      <p><strong>{synthesis.inputs.analyzed} analyzed</strong> of {synthesis.inputs.considered} considered · {skipped} skipped · {synthesis.inputs.eligible} eligible. {notProvided} eligible sessions are outside the supplied cohort.</p>
      <p className="design-footnote">The category counts cover the {synthesis.inputs.analyzed} included analyses. The input deliberately includes invalid results and declared skips; it is not a list of {synthesis.inputs.considered} valid analyses. No cap was hit in this sample; that does not establish complete workspace coverage.</p>
      <details><summary>Skipped sessions and coverage notes</summary>
        <dl className="design-fields">{Object.entries(synthesis.inputs.skipped).map(([reason, count]) => <div key={reason}><dt>{reason}</dt><dd>{count}</dd></div>)}</dl>
        <ul>{synthesis.inputs.notes.map(note => <li key={note}>{note}</li>)}</ul>
      </details>
      <p>{synthesis.freshness.staleCount} of {synthesis.inputs.analyzed} analyses are older than the 24-hour threshold at the frozen generation time. These are retrospective counts, including stale analyses. Missing indexing watermarks: {synthesis.freshness.indexedThroughMissing}.</p>
      <p className="design-footnote">Analyzed-session watermark: {synthesis.freshness.indexedThroughMs === null ? "unknown" : new Date(synthesis.freshness.indexedThroughMs).toISOString()}. It does not cover skipped or absent sessions. Outcome and verification labels come from the fabricated per-session assessments, not independent delivery receipts.</p>
      <h3>Usage coverage, by source</h3>
      <div className="design-projects">{Object.entries(synthesis.usageCoverage).map(([source, usage]) => <Card key={source}>
        <CardHeader><CardTitle>{source}</CardTitle></CardHeader>
        <CardContent>
          <p>{usage.analyzed} analyzed / {usage.considered} considered</p>
          <p>Observed usage: {usage.observed}; unobserved: {usage.unobserved}</p>
          <p>Known cost: {usage.knownCost}; unknown cost: {usage.nullCost}</p>
          <p className="design-footnote">Usage and cost are independent axes. No dollar or token totals are published by this contract.</p>
        </CardContent>
      </Card>)}</div>
      <h3>Work category → session → F1 evidence</h3>
      <label>Pipeline work category <select value={bucket} onChange={event => {setBucket(event.target.value); setSelected(null);}}>
        <option value="">Choose a category</option>
        {synthesis.categories.map(item => <option key={`${item.sessionType}/${item.outcomeStatus}`} value={`${item.sessionType}/${item.outcomeStatus}`}>{item.sessionType} · {item.outcomeStatus} · {item.count}</option>)}
      </select></label>
      {category && <div aria-label="Pipeline category sessions">
        <p>{category.count} sessions; {category.sessions.length} included in this drill-down{category.truncated ? " (truncated)" : ""}.</p>
        {category.sessions.map(ref => <Button key={`${ref.source}/${ref.sessionId}`} variant="outline" size="sm" onClick={() => setSelected(ref)}>Inspect {ref.source} / {ref.sessionId}</Button>)}
      </div>}
      <h3>Recurring failure candidates</h3>
      <p className="design-footnote">Exact artifact/command matches with cited failure claims. These are investigation candidates, not proven team problems or improvement recommendations. Scope groups use repository, project or source as a proxy; same-repository recurrence is excluded by this version’s rule.</p>
      <div className="design-projects">{synthesis.issues.map(issue => <Card key={issue.id}>
        <CardHeader><CardTitle>{issue.key}</CardTitle><p>Candidate · {issue.sessionCount} sessions · {issue.roots} scope groups</p></CardHeader>
        <CardContent>
          <p>{issue.text}</p>
          <p className="design-footnote">{issue.evidence.length} evidence references{issue.evidenceTruncated ? " (truncated)" : ""}; {issue.sessions.length} of {issue.sessionCount} sessions listed{issue.sessionsTruncated ? " (truncated)" : ""}.</p>
          {issue.evidence.map(ref => <Button key={`${ref.source}/${ref.sessionId}/${ref.eventId}`} size="sm" variant="ghost" onClick={() => setSelected(ref)}>Evidence · {ref.source} / {ref.sessionId}</Button>)}
        </CardContent>
      </Card>)}</div>
      <section aria-label="Pipeline v2 producer preview" className="design-notice">
        <h3>Producer v2 preview · simulated model reply</h3>
        <p>This provisional review contract adds initiatives, themes and hypotheses to the same v1 cohort. Everything is synthetic; the reply is hand-written and filtered by the producer validator. It demonstrates the contract, not model quality or a running service.</p>
        <p><a href={`${pipelineV2Source}docs/session-intel-workspace-synthesis.md`} target="_blank" rel="noreferrer">Source-owned workspace-synthesis/2 review contract</a>. Project/team spend attribution and deduplicated token/cost totals remain missing. Its stage2.usage is synthesis-call telemetry, not the team's usage.</p>
        <div className="design-inline">{Object.values(pipelineV2Downloads).map(item => <Button key={item.name} size="sm" variant="outline" onClick={() => onDownload(item.text, item.name, true)}>Download {item.name}</Button>)}</div>
        {[...synthesisV2.stage2.initiatives, ...synthesisV2.stage2.themes].map(item => <div key={item.id}>
          <h4>{item.title}</h4>
          <p>{"goal" in item ? item.goal : `Theme kind: ${item.kind}`}</p>
          <p>{item.sessions.length} supporting sessions · simulated interpretation</p>
          {item.evidence.map(ref => <Button key={`${ref.source}/${ref.sessionId}/${ref.titleRef}`} variant="ghost" size="sm" onClick={() => setSelected(ref)}>Inspect {ref.titleRef} · {ref.source} / {ref.sessionId}</Button>)}
        </div>)}
        {synthesisV2.stage2.hypotheses.map(item => <p key={item.id}>{item.statement} Impact: {item.impact}. Basis: {item.basis.join(", ")}.</p>)}
        <p><strong>{synthesisV2.stage2.truncatedSessions > 0 ? "Partial synthesis: the input cap excluded analyzed sessions." : "All analyzed sessions fit this simulated prompt; eligible workspace coverage remains incomplete."}</strong></p>
        <p className="design-footnote">{synthesisV2.stage2.keptSessions} analyzed sessions included; {synthesisV2.stage2.truncatedSessions} omitted by the prompt cap. Rejected fake-reply items: {synthesisV2.stage2.dropped.initiatives} initiatives, {synthesisV2.stage2.dropped.themes} themes, {synthesisV2.stage2.dropped.hypotheses} hypotheses. A valid reference is not proof the interpretation is correct.</p>
      </section>
      {selected && <section aria-label="Pipeline analysis drill-down" className="design-notice">
        {analysis ? <>
          <h3>{analysis.title}</h3><p>{selected.source} / {selected.sessionId} · analyzed {analysis.analyzedAt}</p>
          {selected.titleRef && <div aria-label="Pipeline v2 claim reference">
            <h4>F1 claim {selected.titleRef}</h4>
            {titleClaim ? <><p>{titleClaim.text} ({titleClaim.basis}, {titleClaim.confidence})</p>{titleClaim.evidenceIds.map(id => <Button key={id} variant="ghost" size="sm" onClick={() => setSelected({source: selected.source, sessionId: selected.sessionId, eventId: id})}>Inspect cited evidence {id}</Button>)}</> : <p>The cited F1 claim is unavailable.</p>}
          </div>}
          <h4>Human intent claims</h4>{analysis.understanding.intents.map((claim, index) => <p key={index}>{claim.text} ({claim.basis}, {claim.confidence})</p>)}
          <h4>Outcome assessments</h4>{analysis.understanding.outcomes.map(outcome => <p key={outcome.id}>{outcome.status} · {outcome.assessment.text} · verification: {outcome.verification.value}</p>)}
          {selected.eventId && <Button variant="outline" size="sm" onClick={() => setSelected({source: selected.source, sessionId: selected.sessionId})}>Back to session evidence</Button>}
          {selected.eventId ? reference ? <div aria-label="Pipeline evidence reference">
            <h4>{reference.kind}</h4><p>{reference.summary}</p>
            {reference.detail && <pre>{reference.detail}</pre>}
            <p>F1 reference ID: <code>{reference.id}</code></p>
            <p>Transcript event UID: <code>{reference.locator.eventUid ?? "unavailable"}</code></p>
            {reference.truncated && <p>Evidence text is truncated.</p>}
          </div> : <p>The cited evidence reference is unavailable.</p> : <div>
            <h4>Included evidence</h4>
            {analysis.evidence.references.map(ref => <Button key={ref.id} size="sm" variant="ghost" onClick={() => setSelected({...selected, eventId: ref.id})}>Inspect {ref.kind} · {ref.id}</Button>)}
          </div>}
          <p className="design-footnote">An issue eventId is an F1 reference ID. Its locator supplies the transcript UID when available. This sample opens the included evidence locally; it does not invent a production transcript URL.</p>
        </> : <p>This session is not part of the validated analyzed cohort.</p>}
      </section>}
    </section>
  );
}
