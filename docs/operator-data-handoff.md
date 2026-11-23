# Operator dashboard: intent, themes and improvement

Designer handoff, 23 November 2026. Start the [design workbench](../tools/design/README.md)
with `npm run design`, then open **Operator concept**. **Data catalog → Team themes & improvement**
lets you copy or download the linked synthetic analysis pack. **Intent, outcomes & work type**
shows an abbreviated per-session analysis excerpt. These are invented examples, not customer data
or a claim that an automatic team analyst is running.

## The operator's questions

1. What outcomes are the humans trying to achieve? Group their root prompts into initiatives,
   retain changes of direction, and show the latest supported outcome, blockers and next step.
2. What recurring issues and themes show up across the team? Distinguish a shared work topic
   from independent repetitions of a problem, and distinguish coordinated fleets from duplicate work.
3. Where and how could the team improve? Show the observation, supporting prompts/actions,
   an actionable hypothesis and how we would measure a change.
4. How is effort distributed? Show work types and observed usage with coverage, then let the
   operator drill into initiative → theme/category → session → cited prompt or tool result.

Keep the first view simple: initiatives and changes needing attention, a small activity summary,
and a few supported improvement opportunities. Keep raw chats and diagnostic detail in drill-downs.
The Desktop IC view remains responsible for individual chats and agent attention.

## What exists, and what still needs work

Source inventory: pipeline main `b3594f11`, independently confirmed by its Session Intelligence
and Reader owners. “Implemented” below means code/contract; it does not mean deployed or populated.
No production enablement or database change was made for this handoff.

| Need | Existing input / contract | Current limit |
| --- | --- | --- |
| Human goals and changes of direction | Per-session analysis `understanding.intents`, `constraints`, `decisions`, each with `evidenceIds`, confidence and basis | Root human intent and child delegated instructions are distinct. Aggregate initiatives are missing. |
| Work categories | `understanding.sessionType`: planning, implementation, debugging, review, testing, research, conversation, mixed, unknown | This classifies a session, not a business initiative. Cross-session categories have no agreed operator endpoint. |
| Results and blockers | `understanding.outcomes[]`, verification, remaining work, contradictions, blockers | Implemented, reported-complete and verified are separate. A passed focused test does not prove an initiative shipped. |
| Evidence and confidence | Analysis evidence references/locators, included versus available coverage, analysis timestamp and source fingerprint | Incomplete or stale inputs must remain visible. A valid schema does not establish interpretation accuracy. |
| Usage and activity | Directory session metadata; organization Usage; analysis `metrics.usage`, tools and interaction periods; output/digest contracts | Incomplete harness attribution and nullable cost. Analyzer backend telemetry is separate from the session's own usage. Activity does not establish effectiveness. |
| Live coordination | `GET /v1/session-intel/workspace?workspace=…`, contract `session-intel-workspace/1` | Alerts, active sessions/open intents, and handoffs/decisions only. Default off, requires migration 062170; no verified populated production overview in this inventory. |
| Daily rollup | `GET /v1/digest/daily`, project/branch groups, session/event counts and recorded usage | A branch group is not a semantic initiative. No current populated-response receipt was supplied. Hide `outcomes.reverted` when the omitted-field header names it. |
| Pattern discovery | Offline workspace pattern CLI with evidence-linked shared-file groups | No HTTP route or prompt-theme model. Shared-file groups do not establish a semantic workstream or a recurring failure. |
| Automatic initiatives, prompt themes and improvement synthesis | The per-session fields above are useful raw material | **Missing aggregate contract and synthesis service.** There is no verified production initiative/theme feed today. |

The analysis read route is `GET /v1/sessions/:id/analysis`, scoped by the Reader's existing
identity and source/workspace contract. It returns jobs/requests and stored results, not the
abbreviated excerpt in the workbench. Absent configuration returns 501 `analysis_not_configured`.
Analysis request/enqueue is a separate mutation; this GET-only design kit does not invoke it.
No verified real F1 samples accompany this kit. The code is implemented and default off;
its deployed and populated state is not verified here. The workspace coordination view needs
migration `20261105062170`; the per-session analysis path also requires its own dependencies.
Do not infer production availability from this design pack or the presence of a frontend.

## Smallest useful data delivery

The next backend deliverable should be a bounded, dated workspace projection over scrubbed
per-session analyses and claims, with a versioned contract agreed with the Reader owner.
Start with one complete cohort, not a global live dashboard. A batch JSON artifact can unblock
layout before a continuously refreshed endpoint exists.

The pipeline design proposes `workspace-synthesis/1` as new code, in two stages:

1. **Deterministic first slice:** completed scrubbed per-session v2 inputs; work-type/outcome
   counts and members, usage coverage, freshness and skipped reasons. Define
   `considered = analyzed + skipped`; define eligibility separately so overlapping populations
   cannot be added. Exact shared artifacts or failed commands are investigation candidates;
   independent failure evidence is needed to call them recurring issues.
2. **Model synthesis later:** initiative goals, semantic themes/issues and improvement hypotheses.
   Each group must resolve to at least two supporting analysis IDs and their evidence IDs in the
   same workspace/window; unresolved references are refused. Model/provider/budget remain open.

Proposed limits: 30 days, 500 sessions with truncation stated, 20 initiatives, 10 issues,
10 hypotheses, five evidence references per item, 280 characters per text field, 256 KB artifact.
Start with a local synthetic artifact and contract; a default-off scoped read route can follow.
The public pack here is a design proposal, not that full source-validated F1 input or a finished
`workspace-synthesis/1` implementation. Actual data still depends on F1 enablement: schema and
completeness proofs, runner image/chart/network/IAM/model configuration, and Reader admission,
storage binding and deployment. These are separate operator-gated work.
Source-session erasure must invalidate or regenerate derived artifacts; a result prefix alone
does not establish permission or freshness. The final contract and exact route are not agreed yet.

**First implementation scope:** a pure aggregator, contract/JSON schema, validated synthetic
F1 cohort, offline CLI artifact and tests. The analysis owner prepares it and the pipeline
owner reviews it. No read route, flag, migration or real-data run is included.
Review readiness and production availability are separate. Stage 2 is separate.

The proposed pack in the workbench demonstrates this shape; its names are **not an agreed API**:

- Explicit organization/workspace, time window, generated-at time, source/analyzer versions and
  whether any page, evidence budget or source is incomplete.
- Recorded, eligible, analyzed, current, stale and unavailable session denominators. Keep unknown
  and unclassified work visible. Count distinct people; deduplicate source/session identity and
  known child fleets; never sum overlapping initiative memberships as unique session totals.
- Initiatives with root human goal, related projects, evidence-backed outcome, blockers, remaining
  work and supporting session/source/evidence identities. Changes in direction supersede earlier intent.
  Initiative grouping may cross repositories and remains inferred until reviewed.
- Work types with counts and drill-down members. Themes with supporting prompt claims, confidence,
  basis and a distinct count of independent roots/people. Repeated agent paraphrases are not new observations.
- Recurring issues only when multiple independent cases support the same failure. Show the numerator
  and relevant eligible denominator, and compare equivalent windows before claiming a trend.
- Improvement opportunities with observation → hypothesis → suggested intervention → measurement,
  supporting citations, review status and unknown impact until measured. No employee productivity ranking.
- Usage totals only over known, deduplicated sources, with separate token/cost coverage and no
  assumed dollar savings, causal attribution or completion percentage.

Evidence drill-down must preserve source plus session identity. Resolve the cited event in the
scoped transcript; if missing, ambiguous or no longer accessible, show that state rather than
linking to a guessed event. Aggregate access must follow existing workspace/sharing and erase rules.
The current workbench opens the supporting session; event IDs are included in the download, but
there is no invented event-anchor URL.

## What the designer can use now

The workbench connects the same invented prompts, agent replies, project summaries and sessions.
The categories/themes are hand-authored; the statistics are calculated over the complete in-memory
fixture cohort, including all 30 busy-team sessions. This is not automatic model output.

Try Small team, Busy team, Missing & stale, Partial coverage and No sessions. Stale and unavailable
analysis does not produce current categories, themes or improvement hypotheses. Missing token
coverage stays visible; cost stays null. Service error/Slow service affect the existing dashboard
reads; the hand-authored concept remains a separately labelled design example.

The improvement sample counts and links every staging-blocker report: one in Small team,
five repeated fixture stories in Busy team. Independent-case count is unknown. It is shown as
a hypothesis with unmeasured impact, not a proven recurring issue. Shared cache/payment/setup topics
are work themes, not evidence that the team is failing.

For the implemented coordination shape, use the full synthetic JSON in the
[workspace API specification](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/docs/session-intel-workspace-api.md).
It includes caps, null coverage, default-off flags and error states. It is a different contract
from the proposed initiative/theme pack. The separate dashboard Session Intelligence work is
tracked in [relay-web #151](https://github.com/AgentWorkforce/relay-web/pull/151).

## Source-owned contracts

- [Per-session analysis v2 and validation](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/src/session-analysis/engine/session-analysis-result.ts)
- [Analysis route configuration and errors](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/src/session-read-api/app.ts)
- [Analysis read lifecycle](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/src/session-analysis/read.ts)
- [Workspace coordination API, full example JSON](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/docs/session-intel-workspace-api.md)
- [Output/digest availability and omitted fields](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/docs/output-digest-clickhouse-design.md)
- [Offline descriptive patterns and their limits](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/docs/session-intel-patterns.md)

The pipeline owner coordinates producer availability; the analysis owner prepares synthesis.
The Reader owner owns scoped read contracts and the coordination owner owns those fixtures.
Real workspace samples belong in a private, access-controlled handoff, never this public repo.
Deploys, migrations, credentials and customer-trace collection retain their existing explicit gates.
