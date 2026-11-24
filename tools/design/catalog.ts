import { synthesis, pipelineSource, pipelineDownloads, synthesisV2, pipelineV2Source, pipelineV2Downloads } from "./pipeline-sample-data";
import { operatorData } from "./operator-data";
import {
  dataset,
  fixtureClock,
  range,
  organization,
  seed,
  workspace,
  type ScenarioId,
} from "./scenarios";
import { fixtureReply } from "./transport";

type Field = { name: string; meaning: string };
export type CatalogEntry = {
  id: string;
  title: string;
  availability: "Available" | "Conditional" | "Experimental" | "Proposed";
  description: string;
  owner: string;
  endpoint: string;
  source?: string;
  rawExport?: { text: string; name: string };
  limitation: string;
  fields: Field[];
  example: (scenario: ScenarioId) => unknown;
};
const control = "https://github.com/AgentWorkforce/relay-control/blob/main/";
const web = "https://github.com/AgentWorkforce/relay-web/blob/main/";
const sessions = `/cloud/api/v1/workspaces/${workspace.id}/sessions`;
const org = `/cloud/api/v1/organizations/${organization.id}`;
const read = (path: string, scenario: ScenarioId) =>
  fixtureReply(new URL(path, "http://design.test"), "GET", scenario);

export const catalog: CatalogEntry[] = [
  {
    id: "sessions",
    title: "Sessions & attribution",
    availability: "Available",
    owner: "Session read API; access through Control",
    endpoint: `${sessions}?metadata=deferred`,
    source: `${web}src/sessions/data.ts`,
    description:
      "The recorded work behind a team or project view. Open a session to inspect the underlying conversation and tool calls.",
    limitation:
      "Fields can be missing across harnesses. A recorded work state is not a live-presence check. Project labels do not define an initiative’s scope.",
    fields: [
      {
        name: "sessionId + source",
        meaning:
          "Use both to identify and open a session. A session ID alone can be ambiguous.",
      },
      {
        name: "userIds / machineIds / agentName",
        meaning:
          "People, machines and the explicitly recorded agent name. These are different identities.",
      },
      {
        name: "project / catalog.repoUrl / catalog.gitBranch",
        meaning: "Recorded attribution; missing metadata stays unknown.",
      },
      {
        name: "totalInputTokens / totalOutputTokens",
        meaning:
          "Nullable counts, not a billing statement. Verify harness coverage before adding totals.",
      },
      {
        name: "now / nextCursor",
        meaning:
          "Fixture reference clock and pagination. The busy scenario spans three pages.",
      },
    ],
    example: (id) => read(`${sessions}?metadata=deferred`, id),
  },
  {
    id: "summary",
    title: "Recorded summaries",
    availability: "Conditional",
    owner: "Session pipeline",
    endpoint: `${sessions}/design-session-1/summary?source=codex&kind=short`,
    source: `${web}src/sessions/model-summary.tsx`,
    description:
      "A short recorded summary of one session, with its model and generation timestamp.",
    limitation:
      "Ready, empty, unsupported and failed reads are distinct. A summary can predate the latest activity; a per-session summary is not a team synthesis.",
    fields: [
      {
        name: "status",
        meaning:
          "ready, empty or unsupported. Failed HTTP reads are another state.",
      },
      {
        name: "builtAt / model",
        meaning:
          "When and how the summary was generated. Compare builtAt with the session’s lastTs.",
      },
      {
        name: "state",
        meaning:
          "Recorded classification with its own timestamp, not a verified completion milestone.",
      },
    ],
    example: (id) =>
      read(`${sessions}/design-session-1/summary?source=codex&kind=short`, id),
  },
  {
    id: "events",
    title: "Transcript evidence",
    availability: "Available",
    owner: "Session read API",
    endpoint: `${sessions}/design-session-1/events?source=codex`,
    source: `${web}src/sessions/api.ts`,
    description:
      "Prompts, agent replies and tool calls supporting the summary. All sample evidence is invented and linked to the same sessions.",
    limitation:
      "A tool result is evidence of that recorded action. Passing focused tests does not prove deployment or completion of an entire project.",
    fields: [
      {
        name: "eventId / ts",
        meaning: "Stable evidence identity and recorded timestamp.",
      },
      {
        name: "kind / type / toolUseId",
        meaning:
          "Distinguish messages from tool calls and match calls to their results.",
      },
      {
        name: "content",
        meaning:
          "Recorded text. Real transcripts remain subject to workspace access and sharing policy.",
      },
    ],
    example: (id) =>
      read(`${sessions}/design-session-1/events?source=codex`, id),
  },
  {
    id: "usage",
    title: "Team usage",
    availability: "Conditional",
    owner: "Control",
    endpoint: `${org}/usage?days=30`,
    source: `${control}docs/usage.md`,
    description:
      "Organization-level active users, uploads, searches and summary counts for 7, 30 or 90 days. This is the production preview’s starting page.",
    limitation:
      "Owner-only and feature-gated. Active users are distinct over the range. Counts describe adoption and activity, not the value or completion of work.",
    fields: [
      {
        name: "totals / days",
        meaning:
          "Range totals and daily buckets. Do not sum daily active users into the range total.",
      },
      {
        name: "unavailable",
        meaning:
          "An unavailable source is named here and its count remains null, not zero.",
      },
    ],
    example: (id) => read(`${org}/usage?days=30`, id),
  },
  {
    id: "people",
    title: "People & projects",
    availability: "Conditional",
    owner: "Control",
    endpoint: `${org}/usage/people?days=30`,
    source: `${control}docs/usage.md`,
    description:
      "Per-member session counts, recent activity and top projects. Each member can be opened to see recorded session titles and summaries.",
    limitation:
      "Owner-only, separately feature-gated, and bounded by a read budget. Truncated counts are lower bounds; this is not a productivity ranking.",
    fields: [
      {
        name: "members[].topProjects",
        meaning:
          "Project attribution from recorded sessions; not cross-project initiative grouping.",
      },
      {
        name: "truncated / unavailable",
        meaning:
          "Signal incomplete coverage; preserve this in any aggregate presentation.",
      },
    ],
    example: (id) => read(`${org}/usage/people?days=30`, id),
  },
  {
    id: "fleet",
    title: "Machines & Desktop",
    availability: "Conditional",
    owner: "Control; reports from Desktop",
    endpoint: `${org}/fleet?days=30`,
    source: `${control}docs/fleet.md`,
    description:
      "The documented fleet endpoint connects members with Desktop machines, last reports and policy state. Useful context for the later IC design pass.",
    limitation:
      "Complete documentation-shaped example only: not served by this preview and not validated by a production dashboard fleet parser. Owner/admin-only. Token session status is not agent liveness.",
    fields: [
      {
        name: "members[].machines",
        meaning:
          "Device sessions for a member; platform and hostname can be missing; lastSeenAt is a required timestamp.",
      },
      {
        name: "policyMatch / lastSeenAt",
        meaning:
          "Policy state and last report, rather than proof a machine is online now.",
      },
    ],
    example: (id) => ({
      exampleOnly: true,
      body: {
        policy_revision: 1,
        range: range(30),
        totals: {
          members: seed.people.length,
          machines: seed.machines.length,
          managed: 0,
          policy: {
            current: 0,
            stale: 0,
            unknown: seed.machines.length,
            mismatch: 0,
          },
          clientVersions: [{ version: null, machines: seed.machines.length }],
        },
        members: seed.people.map((person) => ({
          user: { id: person.id, name: person.name, email: person.email },
          role: person.role,
          machines: seed.machines
            .filter((m) => m.ownerId === person.id)
            .map((m) => ({
              sessionId: m.id,
              hostName: m.name,
              clientVersion: null,
              platform: m.platform,
              enrolledVia: null,
              policyRevision: null,
              policyMatch: "unknown",
              managed: false,
              lastSeenAt: fixtureClock,
              status: "active",
            })),
          usage: {
            sessionsUploaded: dataset(id).filter(({ row }) =>
              row.userIds.includes(person.id),
            ).length,
            lastSessionAt:
              dataset(id).find(({ row }) => row.userIds.includes(person.id))
                ?.row.lastTs ?? null,
            topProjects: [],
          },
        })),
        usage_unavailable: [],
        truncated: false,
        next_cursor: null,
      },
    }),
  },
  {
    id: "overlaps",
    title: "Coordination overlaps",
    availability: "Experimental",
    owner: "Session read API",
    endpoint: "GET /v1/coordination/overlaps (direct reader)",
    source: `${web}src/sessions/overlaps-api.ts`,
    description:
      "An opt-in frontend contract for duplicate work, concurrent edits and related findings, with confidence and evidence.",
    limitation:
      "Off by default. The test fixture exists on main; a running reader’s support is unverified. Estimated duplicate-work cost is not total organization spend. Not enabled in this preview.",
    fields: [
      {
        name: "coverage / evidence / confidence",
        meaning:
          "Preserve scope and supporting events when presenting a finding.",
      },
      {
        name: "estimatedDuplicateCost",
        meaning:
          "A scoped estimate with its own basis, not a billing aggregate.",
      },
    ],
    example: () => ({
      note: "See the existing test-only fixture in src/sessions/overlaps-fixture.ts. No backend availability is asserted.",
    }),
  },
  {
    id: "pipeline-synthesis",
    rawExport: pipelineDownloads.synthesis,
    title: "Pipeline synthesis v1",
    availability: "Experimental",
    owner: "Session analysis pipeline",
    endpoint: "Offline computed artifact; no read route in this source commit",
    source: `${pipelineSource}docs/session-intel-workspace-synthesis.md`,
    description: "The source-owned workspace-synthesis/1 example: deterministic categories, usage coverage, freshness, skipped reasons and exact-key failure candidates, with session/evidence drill-downs in Pipeline sample.",
    limitation: "Pinned unlanded review commit, synthetic only. Frozen separate workspace/window; the Northstar scenario selector does not apply. The cohort deliberately includes malformed results and skipped entries. Outcome categories reflect per-session assessments; roots are repository/project/source scope groups. No initiative, semantic theme, hypothesis, token total or dollar total is present in v1.",
    fields: [
      {name: "inputs.eligible / considered / analyzed / skipped / caps", meaning: "60 eligible, 53 considered, 40 analyzed and 13 skipped in this sample. Seven eligible sessions were not supplied. No cap hit does not imply workspace completeness."},
      {name: "freshness / usageCoverage", meaning: "Frozen generation time; stale analyzed sessions still contribute to this retrospective aggregate. Usage observation and cost availability are independent axes; missing indexing watermarks remain explicit."},
      {name: "categories[].sessions", meaning: "Work-type/outcome partition of analyzed sessions. Preserve source plus sessionId and truncation flags. Inspect locally in Pipeline sample."},
      {name: "issues[].evidence", meaning: "Recurrence candidates with source/session/F1-reference identities. eventId is an F1 reference ID, not a guessed transcript event UID."},
    ],
    example: () => synthesis,
  },
  {
    id: "pipeline-synthesis-v2",
    rawExport: pipelineV2Downloads.synthesis,
    title: "Pipeline synthesis v2 preview",
    availability: "Experimental",
    owner: "Session analysis pipeline",
    endpoint: "Provisional offline contract; no v2 serving in this pin",
    source: `${pipelineV2Source}docs/session-intel-workspace-synthesis.md`,
    description: "Source-owned workspace-synthesis/2 test output: the v1 document plus initiative goals, themes and improvement hypotheses. Inspect its claim references in Pipeline sample.",
    limitation: "Unlanded, provisional review commit. All F1 inputs are synthetic and the model reply is hand-written; no real model call or populated feed is demonstrated. This is separate from the broader Northstar product proposal. Neither version supplies project/team spend attribution. stage2.usage measures the simulated synthesis call, not team activity.",
    fields: [
      {name: "stage2.initiatives / themes / hypotheses", meaning: "Actual producer field names. Hypothesis impact is unmeasured; topic/workflow themes are distinct from recurring-issue labels."},
      {name: "stage2.*.evidence[].titleRef", meaning: "Local F1 claim references: i=human intent, d=decision, b=blocker, o=outcome assessment. Resolve the claim, then its evidenceIds. These are not transcript event IDs."},
      {name: "stage2.dropped / keptSessions / truncatedSessions / stage2Reason", meaning: "Rejected model items, included-session coverage, truncation and unavailable reasons remain explicit. Structural validation does not establish factual accuracy."},
    ],
    example: () => synthesisV2,
  },
  {
    id: "analysis-inputs",
    title: "Intent, outcomes & work type",
    availability: "Conditional",
    owner: "Session analysis pipeline + Reader",
    endpoint: "GET /v1/sessions/:id/analysis (native Reader; configuration required)",
    source: "https://github.com/AgentWorkforce/relayhistory-pipeline/blob/b3594f11/src/session-analysis/engine/session-analysis-result.ts",
    description: "The implemented per-session analysis vocabulary includes human intent, constraints, decisions, blockers, work type, outcomes, verification, metrics and evidence references.",
    limitation: "Abbreviated synthetic excerpt only, not an HTTP response or proof of deployed/populated analysis. The complete result has an envelope, job history, snapshot, coverage and metrics. Child delegated instructions must not be labelled as the root human’s prompt. Both outcome (summary claim) and outcomes[] (per-goal assessments) exist in v2. No verified real samples are available from the current producer inventory.",
    fields: [
      { name: "understanding.intents / constraints / decisions / blockers", meaning: "Claims carry evidenceIds, confidence and observed/inferred/unknown basis." },
      { name: "understanding.sessionType", meaning: "planning, implementation, debugging, review, testing, research, conversation, mixed or unknown. A work category is not an initiative." },
      { name: "understanding.outcomes[]", meaning: "Distinguishes implemented, reported-complete and verified, including remaining work and contradictions. Verification applies to the stated scope." },
      { name: "evidence.references / coverage / analyzedAt", meaning: "Prompt/tool locators, included versus available evidence and analysis time. Stale or incomplete analysis must remain visible." },
      { name: "metrics.usage / tools / interactionPeriods", meaning: "Observed tokens, nullable cost, recorded tool errors and interaction periods. Backend telemetry is the analyzer’s own spend; it must not be counted as the team’s usage." },
    ],
    example: id => ({ abbreviated: true, synthetic: true, notAnHttpResponse: true, sessions: operatorData(id).sessions }),
  },
  {
    id: "operator-data",
    title: "Team themes & improvement",
    availability: "Proposed",
    owner: "Product + session analysis owners",
    endpoint: "No agreed operator synthesis endpoint",
    description: "A downloadable, linked design pack for automatic initiative grouping, human intent, common prompt themes, work categories, improvement hypotheses and statistics with evidence drill-down.",
    limitation: "Grouping and classifications are hand-authored. Counts are calculated over the complete synthetic dataset; this does not implement an automatic analyzer. Shared work themes are separate from recurring issues. Impact, organization spend and initiative completion remain unknown.",
    fields: [
      { name: "scope / generatedAt / coverage", meaning: "Explicit organization/workspace/window; current, stale and unavailable analysis plus token coverage." },
      { name: "statistics.categories / uncategorizedSessions", meaning: "One illustrative primary work type per current analyzed session. Unknown sessions are kept in the denominator; child-fleet deduplication is a production requirement." },
      { name: "themes[].sessionIds / evidenceIds", meaning: "Every proposed theme leads to its supporting root prompts. A recurring issue needs repeated independent evidence and deduplication, not just a shared keyword." },
      { name: "improvementOpportunities", meaning: "Observation, hypothesis, supporting evidence and a suggested measure. No unmeasured savings or employee productivity score." },
    ],
    example: operatorData,
  },
  {
    id: "initiatives",
    title: "Initiatives & decisions",
    availability: "Proposed",
    owner: "Product + session analysis owners",
    endpoint: "No current operator endpoint",
    description:
      "A proposed synthesis of related work, blockers, decisions and next steps. Try the Operator concept to discuss the hierarchy.",
    limitation:
      "These are design-only fields, separate from API fixtures. Grouping, update cadence, conflict handling and evidence coverage need backend agreement. No completion percentage or dollar cost is invented.",
    fields: [
      {
        name: "progress / decision / nextStep",
        meaning:
          "Proposed synthesis fields, not existing server response fields.",
      },
      {
        name: "sessionIds",
        meaning:
          "References to supporting synthetic sessions. Production synthesis needs durable evidence links and freshness.",
      },
    ],
    example: (id) => ({
      designProposal: true,
      initiatives: operatorData(id).initiatives,
    }),
  },
];
