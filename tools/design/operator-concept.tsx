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
            {selectedProject.sessionIds.map((ref) => {
              const record = data.find(({ row }) => row.sessionId === ref)!;
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
                  {item.sessionIds.map((ref) => (
                    <Button
                      key={ref}
                      variant="ghost"
                      size="sm"
                      onClick={() => showSession(ref)}
                    >
                      {data.find(({ row }) => row.sessionId === ref)?.row.title}
                      <ArrowUpRight size={13} />
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="design-footnote">
        Concept scope: the first six synthetic sessions. “Service error” and
        “Slow service” affect the supporting dashboard reads; this hand-authored
        proposal is not a live synthesis.
      </p>
    </section>
  );
}
