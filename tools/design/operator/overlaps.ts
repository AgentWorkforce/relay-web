// Overlaps: where two agents' work touches the same thing. Shaped after the existing experimental
// contract `coordination-overlaps/1` (src/sessions/overlaps-api.ts): a kind, two lanes (sessions),
// shared artifacts, evidence, whether the two sides communicated, a confidence and an estimated
// duplicate cost in tokens. The Northstar fixtures carry no overlap data, so these findings are
// hand-authored on top of its sessions – a design proposal, not detector output.
import type { SessionItem } from "./model";

export type OverlapKind = "concurrent_edit" | "duplicate_work" | "superseded_work" | "repeated_investigation" | "stale_base";
/** What the operator should make of it: worth a look, effort spent twice, or fine (they coordinated) */
export type OverlapCategory = "attention" | "waste" | "coordinated";

export type Overlap = {
  id: string;
  kind: OverlapKind;
  kindLabel: string;
  category: OverlapCategory;
  title: string;
  explanation: string;
  suggestion: string | null;
  confidence: "high" | "medium" | "low";
  communication: "observed" | "not_observed" | "unknown";
  initiative: string | null;
  artifacts: { type: "file" | "branch" | "task"; value: string }[];
  sides: [SessionItem, SessionItem];
  /** Tokens likely spent twice – null when nothing was duplicated */
  duplicateTokens: number | null;
  detectedAt: string;
  evidence: { sessionId: string; text: string; ts: string }[];
};

export const KIND_LABELS: Record<OverlapKind, string> = {
  concurrent_edit: "Same area at the same time",
  duplicate_work: "Same work twice",
  superseded_work: "Overtaken by other work",
  repeated_investigation: "Looked into twice",
  stale_base: "Built on an outdated version",
};
export const CATEGORY_LABELS: Record<OverlapCategory, string> = {
  attention: "Worth a look",
  waste: "Effort spent twice",
  coordinated: "Coordinated",
};

type Template = Omit<Overlap, "id" | "kindLabel" | "sides" | "detectedAt" | "duplicateTokens" | "evidence" | "initiative"> & {
  a: number;
  b: number;
  /** Share of the later side's tokens that went into the duplicated part */
  duplicateShare: number | null;
  evidence: [string, string];
};

// Indexes are positions in the fixture's session list (design-session-1 is 0)
const TEMPLATES: Template[] = [
  {
    a: 2,
    b: 3,
    kind: "stale_base",
    category: "attention",
    title: "Recovery guide written against the old payment logic",
    explanation:
      "Leo's billing-docs agent wrote the webhook recovery guide while Maya's billing-builder was still changing how duplicate payment events are handled. The guide describes the retry behaviour from before the change.",
    suggestion: "Have the docs agent re-read src/payments.ts after the deduplication change, or ask Maya to review the guide before it ships.",
    confidence: "medium",
    communication: "not_observed",
    artifacts: [
      { type: "file", value: "src/payments.ts" },
      { type: "file", value: "docs/recovery.md" },
    ],
    duplicateShare: 0.3,
    evidence: ["Changed retry handling to skip events already processed.", "Documented retries: a failed webhook is retried three times."],
  },
  {
    a: 4,
    b: 5,
    kind: "duplicate_work",
    category: "waste",
    title: "Setup wording reworked twice",
    explanation:
      "Ana's settings-builder and Maya's onboarding-reviewer both reworded the labels in the first-run setup – on separate branches, without seeing each other's change.",
    suggestion: "Keep one wording change and let Maya's reviewer review Ana's branch instead of writing its own.",
    confidence: "medium",
    communication: "not_observed",
    artifacts: [
      { type: "task", value: "First-run setup labels" },
      { type: "file", value: "docs/first-run.md" },
    ],
    duplicateShare: 0.6,
    evidence: ["Renamed the setup entry to “Workspace settings”.", "Two setup labels need clearer language – proposed new wording."],
  },
  {
    a: 0,
    b: 1,
    kind: "concurrent_edit",
    category: "coordinated",
    title: "Edge routing and cache validation in the same service",
    explanation:
      "Ana's edge-builder changed how assets are routed while Leo's cache-reviewer validated cache invalidation in the same service. The two agents messaged each other over the relay and agreed who changes what.",
    suggestion: null,
    confidence: "high",
    communication: "observed",
    artifacts: [
      { type: "branch", value: "feature/edge-service" },
      { type: "file", value: "src/asset-routing.ts" },
    ],
    duplicateShare: null,
    evidence: ["Routing is implemented; asked the cache reviewer to run the cache check.", "Local cache tests pass; waiting for a staging hostname."],
  },
];

/** The busy workspace repeats its work: there, the cache test was investigated twice */
const REPEAT: Template = {
  a: 1,
  b: 7,
  kind: "repeated_investigation",
  category: "waste",
  title: "Cache test investigated twice",
  explanation:
    "Leo's cache-reviewer looked into the same failing cache test twice, hours apart, and reached the same finding both times. The second run didn't use the first run's result.",
  suggestion: "Let the reviewer read the earlier session's finding first – or keep the finding in the project notes.",
  confidence: "high",
  communication: "unknown",
  artifacts: [{ type: "file", value: "test/cache.test.ts" }],
  duplicateShare: 0.9,
  evidence: ["Local cache tests pass. I need a staging hostname.", "Local cache tests pass. I need a staging hostname."],
};

export function overlapsFor(sessions: SessionItem[], initiativeOf: (sessionId: string) => string | null): Overlap[] {
  const at = (i: number) => sessions.find((s) => s.id === `design-session-${i + 1}`);
  const templates = sessions.length > 6 ? [...TEMPLATES, REPEAT] : TEMPLATES;
  return templates.flatMap((t) => {
    const a = at(t.a);
    const b = at(t.b);
    if (!a || !b) return [];
    const later = Date.parse(a.lastTs) > Date.parse(b.lastTs) ? a : b;
    return [
      {
        id: `overlap-${t.a + 1}-${t.b + 1}`,
        kind: t.kind,
        kindLabel: KIND_LABELS[t.kind],
        category: t.category,
        title: t.title,
        explanation: t.explanation,
        suggestion: t.suggestion,
        confidence: t.confidence,
        communication: t.communication,
        initiative: initiativeOf(a.id),
        artifacts: t.artifacts,
        sides: [a, b] as [SessionItem, SessionItem],
        duplicateTokens: t.duplicateShare !== null && later.tokens !== null ? Math.round(later.tokens * t.duplicateShare) : null,
        detectedAt: later.lastTs,
        evidence: [
          { sessionId: a.id, text: t.evidence[0], ts: a.lastTs },
          { sessionId: b.id, text: t.evidence[1], ts: b.lastTs },
        ],
      },
    ];
  });
}
