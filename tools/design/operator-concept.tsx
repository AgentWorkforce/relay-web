import { operatorData } from "./operator-data";
import { OperatorEvidence } from "./operator-evidence";
import { ArrowUpRight } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../src/shell/ui";
import { SessionModelSummary } from "../../src/sessions/model-summary";
import {
  dataset,
  proposedInitiatives,
  seed,
  type ScenarioId,
} from "./scenarios";

export function OperatorConcept({
  scenario,
  project,
  onProject: setProject,
  onInspect: inspect,
  onSession: showSession,
}: {
  scenario: ScenarioId;
  project: string | null;
  onProject: (name: string | null) => void;
  onInspect: (id: string) => void;
  onSession: (id: string) => void;
}) {
  const data = dataset(scenario);
  const analysisPack = operatorData(scenario);
  const selectedProject = proposedInitiatives.find(
    (item) => item.name === project,
  );
  return (
    <section aria-label="Proposed operator overview">
      <div className="design-notice">
        <strong>Proposed product experience</strong>
        <p>
          These initiative summaries, decisions and next steps are hand-authored
          design examples. They are not returned by today’s operator APIs.
          Activity is not completion; no percentage or spend is implied.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inspect("initiatives")}
        >
          Inspect proposed fields
        </Button>
      </div>
      <div className="design-concept-heading">
        <div>
          <p className="design-eyebrow">Northstar Studio / Engineering</p>
          <h2>What moved. What needs you.</h2>
        </div>
        <span>
          {data.length} recorded sessions · {seed.people.length} people
        </span>
      </div>
      {data.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            No recorded work yet. Start with a clear onboarding state.
          </CardContent>
        </Card>
      ) : selectedProject ? (
        <section
          className="design-project-detail"
          aria-label="Proposed project drill-down"
        >
          <Button variant="ghost" size="sm" onClick={() => setProject(null)}>
            ← All projects
          </Button>
          <h2>{selectedProject.name}</h2>
          <p>{selectedProject.progress}</p>
          <h3>What the humans asked for</h3>
          {data.filter(({row}) => row.project.name === selectedProject.name).map(({row, events}) => <div key={row.sessionId} className="design-notice"><p>{events[0]!.content}</p><Button variant="ghost" size="sm" onClick={() => showSession(row.sessionId)}>Inspect original prompt</Button></div>)}
          {selectedProject.decision && (
            <div className="design-notice">
              <strong>Proposed decision needed</strong>
              <p>{selectedProject.decision}</p>
            </div>
          )}
          <p>
            <strong>Proposed next step:</strong> {selectedProject.nextStep}
          </p>
          <h3>Recorded session evidence</h3>
          <p className="design-footnote">
            The summaries below reuse the production summary component. An
            absent summary stays absent even when the proposed synthesis above
            makes a claim.
          </p>
          <div className="design-project-detail-sessions">
            {data.filter(({ row }) => row.project.name === selectedProject.name).map((record) => {
              const ref = record.row.sessionId;
              return (
                <Card key={ref}>
                  <CardHeader>
                    <CardTitle>{record.row.title}</CardTitle>
                    <p className="design-footnote">
                      {
                        seed.people.find((p) =>
                          record.row.userIds.includes(p.id),
                        )?.name
                      }{" "}
                      · {record.row.agentName} ·{" "}
                      {
                        seed.machines.find((m) =>
                          record.row.machineIds.includes(m.id),
                        )?.name
                      }
                    </p>
                  </CardHeader>
                  <CardContent>
                    <SessionModelSummary summary={record.summary} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => showSession(ref)}
                      className="mt-4"
                    >
                      Inspect transcript <ArrowUpRight size={13} />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="design-projects">
          {proposedInitiatives.map((item) => (
            <Card key={item.name}>
              <CardHeader>
                <div className="design-inline design-between">
                  <span
                    className={`design-pill ${item.decision ? "design-pill-attention" : ""}`}
                  >
                    {item.status}
                  </span>
                  <span className="design-proposed-label">
                    Proposed synthesis
                  </span>
                </div>
                <CardTitle className="text-xl mt-3">
                  <button
                    className="design-project-link"
                    onClick={() => setProject(item.name)}
                  >
                    {item.name}
                    <ArrowUpRight size={17} />
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysisPack.initiatives.find(initiative => initiative.title === item.name) && <p><strong>Human goal:</strong> {analysisPack.initiatives.find(initiative => initiative.title === item.name)!.humanGoal}</p>}
                <p>{item.progress}</p>
                {item.decision && (
                  <div className="design-decision">
                    <strong>Decision needed</strong>
                    <p>{item.decision}</p>
                  </div>
                )}
                <div className="design-next">
                  <span>Next step</span>
                  <p>{item.nextStep}</p>
                </div>
                <div className="design-evidence">
                  <span>Supporting sessions</span>
                  {data.filter(({ row }) => row.project.name === item.name).slice(0, 3).map(({row}) => (
                    <Button
                      key={row.sessionId}
                      variant="ghost"
                      size="sm"
                      onClick={() => showSession(row.sessionId)}
                    >
                      {row.title}
                      <ArrowUpRight size={13} />
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => setProject(item.name)}>View all {data.filter(({row}) => row.project.name === item.name).length} supporting sessions</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!selectedProject && <OperatorEvidence scenario={scenario} onSession={showSession} onInspect={inspect} />}
      <p className="design-footnote">
        Counts and project membership use the complete selected synthetic cohort.
        “Service error” and “Slow service” affect the supporting dashboard reads;
        this hand-authored proposal is not a live synthesis.
      </p>
    </section>
  );
}
