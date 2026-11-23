# Designer onboarding: dashboard first, Desktop next

The first design pass is an operator overview and one project drill-down.
This brief comes from the November 23, 2026 product onboarding discussion.
It records product direction, not customer research or a commitment that every
proposed field is already available.

## Start in five minutes

You need Git access and Node **22.12 or newer**, with npm. Clone
`AgentWorkforce/relay-web` (some existing local checkouts are named
`relay-webapp`), then:

```sh
npm ci
npm run design
```

Open **http://127.0.0.1:5174/**. No other repository, account, API credential,
Docker, Kubernetes or model key is required. Stop with Ctrl-C. If the port is
occupied, stop your own previous workbench; the server refuses to select a
surprise port. Commands here run from the `relay-web` checkout, not infra.

1. Start with **Dashboard → Team usage**. This renders the production React
   application with synthetic responses. Open the people drill-down and a session.
2. Edit a heading or layout in `src/admin/usage.tsx`, `src/admin/usage-people.tsx`
   or `src/sessions/SessionsPage.tsx`. The preview updates with Vite hot reload.
3. Open **Data catalog** to inspect and copy each response. Every entry names
   its owner, source contract, permissions and limits. “Available” means there
   is a source contract; deployed support must still be verified.
4. Try **Missing & stale**, **Partial coverage**, **No sessions**, **Service
   error** and **Slow service**, plus the 30-session **Busy team**. The slow
   scenario waits 30 seconds so loading remains visible.
5. Try **Operator concept**, a hand-authored proposal whose evidence buttons
   open the same synthetic sessions in the real dashboard. Its synthesis fields
   are explicitly separate from current server responses.
6. Use **Copy view link**, **Open preview**, the 390px width and theme toggle
   during working sessions. A localhost link works for someone running this
   branch locally; it is not a remotely hosted preview. Export the JSON or take
   a screenshot for an asynchronous review.

The fictional Northstar Studio has three people, three machines and three
projects. People, sessions, transcripts and summaries are linked. The scenario
reference clock is anchored at **12:00 UTC on the current day**; these are not live activity reports.
Change the story in `tools/design/fixtures/northstar.json`. Change scenario
behavior in `tools/design/scenarios.ts`. Download the scenario pack from
**Start here** to inspect the complete local data.

## What the first screen should accomplish

The operator is a CTO or engineering lead trying to understand work across
the team. In one glance they should know:

- What changed or moved forward across the important projects?
- What is blocked, and what decision would unblock it?
- What resources did the work consume, where measured?
- Where can they inspect the supporting evidence?

Begin with one calm overview and one project drill-down. Review small changes
in short working sessions before expanding the navigation. Progress prose can
be more honest than a percentage: a percentage needs an agreed scope and
milestones. Session count, commits, lines changed and time are activity signals,
not measurements of completed business outcomes.

The Desktop/IC experience has a different job: find agents and sessions across
local, remote and cloud machines, understand a session at a glance, inspect or
continue a conversation, and find CLI setup/settings easily. Broader native
previews are a second pass. The macOS app is SwiftUI over the Rust Desktop core;
this React workbench does not implement or replace native screens.

## Data map

| Domain | Where to look | Limits to design for |
| --- | --- | --- |
| Recorded session identity, attribution and nullable token counts | `src/sessions/data.ts`, `src/sessions/api.ts` | Keep `sessionId` and `source` together; project, people, model and machine metadata can be missing |
| Recorded short summary | `src/sessions/model-summary.tsx` | Ready, empty, unsupported and failed are different; compare generation time with latest session activity |
| Organization usage and people | `src/admin/contracts.ts`, Control `docs/usage.md` | Owner-only; feature-gated; truncated people counts are lower bounds; missing is not zero |
| Transcript/tool evidence | `src/sessions/api.ts`, `src/sessions/SessionView.tsx` | Evidence of recorded actions does not prove deployment or project completion |
| Machine fleet | Control `docs/fleet.md` | Owner/admin-only; last report and token session status are not proof of current agent presence |
| Coordination overlaps | `src/sessions/overlaps-api.ts`, existing test-only fixture | Experimental and off by default; direct read API; running-backend support unverified |
| Initiatives, decisions, blockers, next steps | Product proposal in `tools/design/scenarios.ts` | No current general operator contract; agree grouping, freshness, coverage and evidence attribution with backend owners |
| Dollar spend | No general operator aggregate identified | Nullable token counts do not establish cost; pricing basis, harness coverage and estimate versus invoice need agreement |

Control’s canonical HTTP reference is
[openapi.yaml](https://github.com/AgentWorkforce/relay-control/blob/main/openapi.yaml).
Session content belongs to the pipeline/read API. Control owns access, identity,
workspaces and credential handoff; it is not a second session store.

## Inputs for the first review

The product leads should supply three to five approved customer conversation excerpts.
For each, record the user’s role, the question they were trying to answer, the
decision that followed and the evidence they needed. Those excerpts are not
included in this public repository. The meeting provides product direction;
it does not establish which data customers use most.

Bring one overview, one project drill-down, a missing-data state and a list of
proposed fields. Trace each displayed claim back to a catalog entry or mark it
proposed. Agree on the information hierarchy before adding more views.

## Engineering handoff

Run `npm run check` before submitting changes. See
[the workbench implementation guide](../tools/design/README.md) for fixtures,
contract checks, isolation and extending supported reads. Production integration
uses normal cookie login and existing Control/read API contracts. For a full
local stack, use infra’s [development launcher](https://github.com/AgentWorkforce/infra/blob/main/docs/dev-launcher.md)
on an appropriate developer fixture; that workflow has additional prerequisites.
Do not run system trust changes on a designer’s general workstation as part of
this onboarding.
