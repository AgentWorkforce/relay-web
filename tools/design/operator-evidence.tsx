import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../../src/shell/ui";
import { operatorData } from "./operator-data";
import type { ScenarioId } from "./scenarios";

export function OperatorEvidence({ scenario, onSession, onInspect }: { scenario: ScenarioId; onSession: (id: string) => void; onInspect: (id: string) => void }) {
  const data = operatorData(scenario);
  const [category, setCategory] = useState<string | null>(null);
  const selected = data.statistics.categories.find(item => item.value === category);
  return <section aria-label="Proposed team analysis" className="design-project-detail">
    <h3>What people are trying to move forward</h3>
    <p>{data.coverage.recordedSessions} recorded sessions · {data.statistics.people} people · {data.coverage.currentAnalysisSessions} current analysis examples · {data.coverage.tokenSessions} sessions with token counts</p>
    <p className="design-footnote">Hand-authored analysis examples. Categories and themes below demonstrate a proposed synthesis. Unknown work stays uncategorized; shared topics do not establish repeated failures.</p>
    <div className="design-inline">
      {data.statistics.categories.map(item => <Button key={item.value} size="sm" variant={category === item.value ? "secondary" : "outline"} onClick={() => setCategory(category === item.value ? null : item.value)}>{item.value} ({item.sessionIds.length})</Button>)}
      <span>Uncategorized ({data.statistics.uncategorizedSessions})</span>
      <Button size="sm" variant="ghost" onClick={() => onInspect("operator-data")}>Inspect / download analysis pack</Button>
    </div>
    {selected && <div aria-label="Work category drill-down">
      <h4>{selected.value}: human prompts</h4>
      {data.sessions.filter(session => selected.sessionIds.includes(session.sessionId)).map(session => <div key={session.sessionId} className="design-notice">
        <p>{session.understanding?.intents[0]?.text}</p>
        <Button size="sm" variant="ghost" onClick={() => onSession(session.sessionId)}>Open prompt evidence · {session.sessionId}</Button>
      </div>)}
      {selected.sessionIds.length === 0 && <p>No current analysis supports this category.</p>}
    </div>}
    {data.coverage.staleAnalysisSessions > 0 && <p>Analysis is older than activity in {data.coverage.staleAnalysisSessions} sessions. Refresh is needed before making a current team synthesis.</p>}
    {data.coverage.unavailableAnalysisSessions > 0 && <p>Analysis is unavailable for {data.coverage.unavailableAnalysisSessions} sessions. Recorded transcripts are still available.</p>}
    <div className="design-projects">
      {data.themes.map(theme => <Card key={theme.id}>
        <CardHeader><CardTitle>{theme.title}</CardTitle><p>Proposed work theme · {theme.sessionIds.length} sessions · inferred</p></CardHeader>
        <CardContent>{theme.sessionIds.map(id => <Button key={id} size="sm" variant="ghost" onClick={() => onSession(id)}>Prompt · {id}</Button>)}</CardContent>
      </Card>)}
    </div>
    {data.improvementOpportunities.map(item => <div className="design-notice" key={item.id}>
      <strong>Improvement hypothesis</strong><p>{item.observation}</p><p>{item.recommendation}</p>
      <p className="design-footnote">One observed blocker; recurrence and impact are unproven. {item.suggestedMeasure}</p>
      <Button size="sm" variant="outline" onClick={() => onSession(item.sessionIds[0]!)}>Inspect supporting report</Button>
    </div>)}
  </section>;
}
