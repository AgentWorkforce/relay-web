# Operator dashboard: intent, themes and improvement

Designer handoff, 23 November 2026. Start the [design workbench](../tools/design/README.md)
with `npm run design`, then open **Operator concept**. **Data catalog → Team themes & improvement**
lets you copy or download the linked synthetic analysis pack. **Intent, outcomes & work type**
shows an abbreviated per-session analysis excerpt. These are invented examples, not customer data
or a claim that an automatic team analyst is running.

## Product brief: what the operator needs to decide

Start with a CTO/VP Engineering asking: what outcomes is the team pursuing, what is getting delivered,
and where would an intervention improve progress? Give each initiative a plain-language goal and its
product/customer context when known. Product context and business priority need a maintained source;
do not infer an agreed priority from how often a prompt mentions a topic.

- Show supported progress, blockers and the next decision before individual agent activity.
- Compare observed token/cost consumption and models used with outcomes and verification. Keep rework,
  failed attempts and unknown coverage visible. Token volume, output length and session counts alone do
  not measure efficiency or business value.
- Separate related work, useful collaboration, overlapping work and conflicting changes. A shared file
  or topic is an investigation lead, not proof of waste. Link each relationship to supporting sessions.
- Put agent/session/message statistics below the initiative story, with drill-down by scope and time.
- Surface Relay collection, indexing and analysis failures as data-health issues so missing data cannot
  be mistaken for an inactive team. Keep these distinct from failures in the team's own tasks.

First design review: one simple overview, one initiative-to-evidence drill-down, one overlap investigation,
and one incomplete/stale state. Leave completion percentages, efficiency scores and improvement savings
unknown unless a source and measurement support them. This is a product brief, not an extra API contract.

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
| Automatic initiatives, prompt themes and improvement synthesis | Reviewed Stage 1 branch and provisional `workspace-synthesis/2` code/fixtures (below) | Unlanded and no verified populated production feed. Runtime model transport, durable budget ledger and v2 serving remain separate work. |

The analysis read route is `GET /v1/sessions/:id/analysis`, scoped by the Reader's existing
identity and source/workspace contract. It returns jobs/requests and stored results, not the
abbreviated excerpt in the workbench. Absent configuration returns 501 `analysis_not_configured`.
Analysis request/enqueue is a separate mutation; this GET-only design kit does not invoke it.
No verified real F1 samples accompany this kit. The code is implemented and default off;
its deployed and populated state is not verified here. The workspace coordination view needs
migration `20261105062170`; the per-session analysis path also requires its own dependencies.
Do not infer production availability from this design pack or the presence of a frontend.

## Source-owned sample available now

Open **Pipeline sample** in the workbench. It imports pipeline review commit
[`1e6d6e46e`](https://github.com/AgentWorkforce/relayhistory-pipeline/commit/1e6d6e46e8008fb399cd79ae59182bb734b28e4e),
which is unlanded and synthetic. The source's 30 synthesis tests passed independently at that
exact commit. The workbench preserves the source cohort and computed output byte-for-byte,
exports its JSON schema, and records hashes and source paths in the
[fixture provenance](../tools/design/fixtures/synthesis/README.md).

The sample has 60 eligible, 53 considered, 40 analyzed and 13 skipped sessions. Seven eligible
sessions are not supplied; negative cases deliberately exercise the skip paths. No configured
cap is hit, which does not imply full workspace coverage. Its 34 work-type/outcome buckets
partition the 40 included analyses, and three exact-key failure candidates cite included F1
evidence. Scope-group counts use repository/project/source keys, not proved human/fleet roots.

This is a frozen November 1–8 cohort. The 35 stale analyses are counted relative to its injected
November 8 generation time, and still contribute to the retrospective aggregate. Do not combine
its clocks, workspace or memberships with the Northstar scenarios. The sample view disables the
scenario selector and opens F1 evidence locally; it never guesses a production session URL.

The actual `/1` artifact contains coverage, freshness, usage coverage, categories and recurrence
candidates. **It has no initiatives, semantic themes, improvement hypotheses or token/cost sums.**
Those remain proposals for a later synthesis stage. The broader Operator concept and its
Northstar pack are explicitly separate. No route, deploy or real data is supplied by this source
commit. Use the [source-owned contract](https://github.com/AgentWorkforce/relayhistory-pipeline/blob/1e6d6e46e8008fb399cd79ae59182bb734b28e4e/docs/session-intel-workspace-synthesis.md)
for exact fields, caps, skip reasons and the evidence-reference interpretation.

### Alignment with current producer review branches

The v1 cohort and golden are byte-identical at accepted Stage 1 review head
[`d75b6320`](https://github.com/AgentWorkforce/relayhistory-pipeline/commit/d75b63208ba8c13d2e0bdc2160ad3b847f2d4b0a),
and its schema source is unchanged from the pinned export. That branch adds an offline job and a
default-off `GET /v1/session-intel/synthesis` route; neither exists in the original sample pin.
The pipeline owner reports it awaits landing after the schema release freeze.

**Pipeline sample → Producer v2 preview** and **Data catalog → Pipeline synthesis v2 preview** now
include the source-owned provisional test golden from
[`923778b5`](https://github.com/AgentWorkforce/relayhistory-pipeline/commit/923778b559c6090565814e90cfaf3c49684da98d).
All F1 inputs are invented and the model reply is hand-written. The producer filters the fake reply;
there is no real model call. The source's v1/v2 tests passed independently: 63 tests, 920 assertions.
The output, fake reply and prompt projection are preserved byte-for-byte with a separate provenance
receipt. This is an unlanded review contract and can still change.

The actual v2 shape is v1 plus `stage2` and `stage2Reason`. `stage2` contains `initiatives`, `themes`,
`hypotheses`, rejected-item counts, prompt session coverage and synthesis-call telemetry. Initiatives
have a goal and supporting sessions; themes have a kind (`topic`, `workflow`, `recurring_issue`).
Hypotheses cite retained initiatives/themes and always carry `impact: "unmeasured"`. References use
`{source, sessionId, titleRef}` to identify a local F1 claim, then its evidence IDs; these differ from
v1's recurrence references. The broader Northstar pack is a product proposal, **not** this wire shape.

Neither version supplies owner/team joins, project/team token/cost totals or parent/child/cross-source
usage deduplication. The analysis owner has taken the spend-attribution slice design; the owner/team
mapping source still needs an owner. This is required to answer whether a project merits more token budget.

Active work confirmed by the analysis owner: finish v2 review, add model transport and default-off v2
serving, then durable budget storage and the attribution design. F1 production enablement remains with
the pipeline operations lanes. No verified real populated F1 or synthesis feed was reported. This is an
owner-reported work queue, not a delivery receipt or authorization to enable production.

## Smallest useful data delivery

The next backend deliverable should be a bounded, dated workspace projection over scrubbed
per-session analyses and claims, with a versioned contract agreed with the Reader owner.
Start with one complete cohort, not a global live dashboard. A batch JSON artifact can unblock
layout before a continuously refreshed endpoint exists.

The pipeline review branches split the work into two stages:

1. **Deterministic first slice:** completed scrubbed per-session v2 inputs; work-type/outcome
   counts and members, usage coverage, freshness and skipped reasons. Define
   `considered = analyzed + skipped`; define eligibility separately so overlapping populations
   cannot be added. Exact shared artifacts or failed commands are investigation candidates;
   independent failure evidence is needed to call them recurring issues.
2. **Model synthesis later:** initiative goals, semantic themes/issues and improvement hypotheses.
   Each group must resolve to at least two supporting analysis IDs and their evidence IDs in the
   same workspace/window; unresolved references are refused. The provisional `/2` contract uses local
   F1 title references, not the Northstar proposal's evidence field names. Runtime and budget wiring remain incomplete.

The pinned v1 bounds include a 30-day window, 500 considered sessions, 10 issue candidates,
five evidence references per issue, 280-character text fields and a 256 KB artifact. The provisional
v2 bounds allow 10 initiatives, 10 themes and five hypotheses, with up to 20 supporting sessions and
claim citations per initiative/theme. Use each pinned contract for its exact bounds and truncation rules.
Start with a local synthetic artifact and contract; a default-off scoped read route can follow.
The public pack here is a design proposal, not that full source-validated F1 input or a finished
`workspace-synthesis/1` implementation. Actual data still depends on F1 enablement: schema and
completeness proofs, runner image/chart/network/IAM/model configuration, and Reader admission,
storage binding and deployment. These are separate operator-gated work.
Source-session erasure must invalidate or regenerate derived artifacts; a result prefix alone
does not establish permission or freshness. The first review contract is pinned in the source-owned sample above; a production read route is not verified here.

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
