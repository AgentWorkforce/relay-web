import { ArrowUpRight, Download } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../src/shell/ui";
import {
  dataset,
  fixtureClock,
  proposedInitiatives,
  seed,
  type ScenarioId,
} from "./scenarios";

export function GuidePanel({
  scenario,
  onConcept,
  onDownload: download,
}: {
  scenario: ScenarioId;
  onConcept: () => void;
  onDownload: (value: unknown, name: string) => void;
}) {
  return (
    <section className="design-guide" aria-label="Designer onboarding">
      <Card>
        <CardHeader>
          <CardTitle>One overview. One drill-down.</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            The dashboard is for the operator: understand progress across the
            team and decide what to unblock. Desktop is for the individual
            contributor: find sessions across machines, inspect work and
            continue a conversation.
          </p>
          <ol>
            <li>
              <strong>Explore the actual UI.</strong> Open Team usage, then a
              person’s sessions, then a transcript. Change a heading in{" "}
              <code>src/admin/usage.tsx</code> and see hot reload.
            </li>
            <li>
              <strong>Inspect the available data.</strong> Use the catalog to
              connect every visual element to a real field or mark it proposed.
            </li>
            <li>
              <strong>Sketch the smallest operator view.</strong> Answer what
              changed, what needs a decision, and where the evidence lives.
            </li>
            <li>
              <strong>Review in a short working session.</strong> Bring one
              overview and one drill-down. Agree on hierarchy before adding more
              views.
            </li>
          </ol>
          <Button variant="outline" onClick={onConcept}>
            Explore the concept <ArrowUpRight size={14} />
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your development map</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="design-fields">
            <div>
              <dt>
                <code>relay-web / src/</code>
              </dt>
              <dd>
                The actual React dashboard, shell and components. The local
                checkout may be named relay-webapp.
              </dd>
            </div>
            <div>
              <dt>
                <code>tools/design/fixtures/northstar.json</code>
              </dt>
              <dd>
                Fictional people, machines, projects and work. Edit this JSON to
                change the story.
              </dd>
            </div>
            <div>
              <dt>
                <code>tools/design/scenarios.ts</code>
              </dt>
              <dd>
                Scenario states and separately marked proposed initiative
                fields.
              </dd>
            </div>
            <div>
              <dt>
                <code>relay-control / openapi.yaml</code>
              </dt>
              <dd>
                Control’s HTTP contracts. Session content is owned by the
                pipeline/read API.
              </dd>
            </div>
            <div>
              <dt>
                <code>relay-desktop / macos/</code>
              </dt>
              <dd>
                SwiftUI, with a Rust core. The next native design pass needs
                native previews, not React screens.
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Before calling a signal “available”</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            Check its endpoint, access role, deployment capability, freshness
            and coverage. Missing is not zero. Active is not online. Sessions
            uploaded is not progress. Nullable tokens are not a dollar bill.
          </p>
          <p>
            Customer evidence is still needed. The product leads should provide
            three to five approved excerpts explaining the operator’s question
            and decision. The meeting brief is in{" "}
            <code>docs/designer-onboarding.md</code>; this kit does not invent
            customer interviews.
          </p>
          <p>
            Scenario clock: <time>{fixtureClock}</time>. Scenarios are
            reproducible within the current UTC day.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              download(
                {
                  fictional: true,
                  clock: fixtureClock,
                  seed,
                  sessions: dataset(scenario),
                  proposedInitiatives,
                },
                `relay-${scenario}-design-pack.json`,
              )
            }
          >
            <Download size={14} /> Download scenario pack
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
