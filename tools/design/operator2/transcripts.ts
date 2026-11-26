// Sample conversations for the session page's chat layout. The fixtures record only a session's first
// prompt and its last answer, so these fill in what happened between – the back and forth, what the
// person attached, what the agent read, ran and changed – written by hand, one per kind of work in the
// scenario. Each starts with the session's real prompt and ends with its real result, so the chat agrees
// with every other page. A real transcript from Agent Relay replaces this.
import type { SessionItem } from "../operator/model";

export type Attachment =
  | { kind: "image"; name: string; size: string }
  | { kind: "file"; name: string; size: string }
  | { kind: "paste"; lines: number };

/** One thing the agent did between messages */
export type Step =
  | { kind: "read"; target: string }
  | { kind: "search"; target: string }
  | { kind: "edit"; target: string; added: number; removed: number }
  | { kind: "run"; command: string; output: string };

export type Turn =
  | { role: "user"; text: string; attachments?: Attachment[] }
  | { role: "agent"; steps?: Step[]; text: string };

type Script = Turn[];

const SCRIPTS: Record<string, Script> = {
  "Move asset delivery to the edge": [
    { role: "user", text: "", attachments: [{ kind: "file", name: "edge-rollout-plan.md", size: "4 KB" }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "edge-rollout-plan.md" },
        { kind: "search", target: "assetUrl(" },
        { kind: "read", target: "src/asset-routing.ts" },
        { kind: "read", target: "src/cache/invalidate.ts" },
      ],
      text: "I read the rollout plan. Assets are resolved in two places today: `assetUrl()` in the app and the CDN rewrite rules. I'd move both behind one edge handler so cache keys stay identical.\n\nOne question before I change anything: should the old origin path keep working during the rollout, or can it redirect right away?",
    },
    { role: "user", text: "Keep the old path working until we've validated in staging. Redirect only after that." },
    {
      role: "agent",
      steps: [
        { kind: "edit", target: "src/asset-routing.ts", added: 84, removed: 12 },
        { kind: "edit", target: "src/edge/handler.ts", added: 46, removed: 0 },
        { kind: "run", command: "npm test -- asset-routing", output: "Tests: 18 passed, 18 total\nTime: 4.2 s" },
      ],
      text: "Done:\n- The edge handler serves `/assets/*` and falls back to the origin when the edge has no copy.\n- The old origin path still answers – no redirect yet.\n- Cache keys are unchanged, so invalidation keeps working as before.",
    },
    { role: "user", text: "Here's what I see on the preview deploy – images on the pricing page are missing.", attachments: [{ kind: "image", name: "pricing-preview.png", size: "312 KB" }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "pricing-preview.png" },
        { kind: "search", target: "pricing/hero" },
        { kind: "edit", target: "src/edge/handler.ts", added: 6, removed: 2 },
        { kind: "run", command: "npm test", output: "Tests: 214 passed, 214 total\nTime: 31.8 s" },
      ],
      text: "The pricing images use a versioned path (`/assets/v2/…`) that my route didn't match. Fixed the pattern and added a test for it.\n\nRouting is implemented and the focused tests pass. Staging validation is still pending.",
    },
  ],
  "Validate cache invalidation": [
    { role: "user", text: "" },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "docs/cache-contract.md" },
        { kind: "read", target: "test/cache.test.ts" },
        { kind: "search", target: "purge(" },
      ],
      text: "The contract has three rules: a deploy purges changed assets, a manual purge clears one path, and stale content is never served longer than 60 seconds. The existing tests cover the first two, not the 60-second rule.\n\nShould I add a test for it, or only check the current behaviour?",
    },
    { role: "user", text: "Add a test – that rule is the one support keeps asking about.", attachments: [{ kind: "paste", lines: 38 }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "Pasted text · 38 lines" },
        { kind: "edit", target: "test/cache.test.ts", added: 52, removed: 3 },
        { kind: "run", command: "npm test -- cache", output: "Tests: 11 passed, 11 total\nTime: 2.9 s" },
      ],
      text: "Thanks for the support log – it shows the stale window reaching 90 seconds when a purge and a deploy overlap. The new test reproduces that case locally and now passes against the edge handler.",
    },
    { role: "user", text: "Can you run it against staging too?" },
    {
      role: "agent",
      steps: [{ kind: "run", command: "npm run test:integration -- --env staging", output: "Error: STAGING_HOST is not set" }],
      text: "Local cache tests pass. I need a staging hostname before running the integration check.",
    },
  ],
  "Handle duplicate payment events": [
    { role: "user", text: "", attachments: [{ kind: "image", name: "stripe-dashboard-duplicates.png", size: "248 KB" }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "stripe-dashboard-duplicates.png" },
        { kind: "read", target: "src/payments.ts" },
        { kind: "search", target: "event.id" },
      ],
      text: "The screenshot shows the same `invoice.paid` event delivered three times within a second. The handler doesn't check whether it has seen an event before, so each delivery books the payment again.\n\nI'd store each processed event id and skip repeats. Is a database table fine, or do you prefer Redis?",
    },
    { role: "user", text: "Use the database – we want it in the audit trail anyway." },
    {
      role: "agent",
      steps: [
        { kind: "edit", target: "migrations/0042_processed_events.sql", added: 14, removed: 0 },
        { kind: "edit", target: "src/payments.ts", added: 31, removed: 8 },
        { kind: "edit", target: "test/payments.test.ts", added: 44, removed: 0 },
        { kind: "run", command: "npm test -- payments", output: "Tests: 27 passed, 27 total\nTime: 6.1 s" },
      ],
      text: "Added event deduplication and a regression test. The focused test suite passes.",
    },
  ],
  "Document webhook recovery": [
    { role: "user", text: "", attachments: [{ kind: "file", name: "incident-2026-11-18.md", size: "9 KB" }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "incident-2026-11-18.md" },
        { kind: "read", target: "docs/recovery.md" },
      ],
      text: "From the incident notes, the gap is the replay step: the guide says “resend the webhook” but not how, or how to check it arrived. I'll add a replay example with the CLI and a short verification checklist.",
    },
    { role: "user", text: "Good. Keep it short – people read this during an incident." },
    {
      role: "agent",
      steps: [
        { kind: "edit", target: "docs/recovery.md", added: 38, removed: 9 },
        { kind: "run", command: "npm run docs:lint", output: "✓ 42 files checked, no problems" },
      ],
      text: "Updated the recovery guide with a replay example and verification steps.",
    },
  ],
  "Make workspace settings easier to find": [
    { role: "user", text: "", attachments: [{ kind: "image", name: "settings-hidden.png", size: "186 KB" }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "settings-hidden.png" },
        { kind: "read", target: "src/navigation.tsx" },
        { kind: "read", target: "src/avatar-menu.tsx" },
      ],
      text: "Right now settings are only in the avatar menu, two clicks deep. I'd add a Settings entry at the bottom of the sidebar, above the account – visible on every page.",
    },
    { role: "user", text: "Yes, and keep the avatar menu entry so nobody's muscle memory breaks." },
    {
      role: "agent",
      steps: [
        { kind: "edit", target: "src/navigation.tsx", added: 22, removed: 4 },
        { kind: "run", command: "npm test -- navigation", output: "Tests: 9 passed, 9 total\nTime: 1.7 s" },
      ],
      text: "Added a visible settings entry. I am checking focus order and keyboard navigation.",
    },
  ],
  "Review first-run setup": [
    { role: "user", text: "", attachments: [{ kind: "paste", lines: 64 }] },
    {
      role: "agent",
      steps: [
        { kind: "read", target: "Pasted text · 64 lines" },
        { kind: "read", target: "docs/first-run.md" },
        { kind: "run", command: "relay init --dry-run", output: "? Workspace slug: \n? Connect a harness: (claude, codex, cursor)\n✓ Dry run complete" },
      ],
      text: "I went through the setup output you pasted and ran it myself. Most of it reads well. Two prompts are unclear:\n- “Workspace slug” – first-time users don't know what a slug is.\n- “Connect a harness” – nobody calls their coding tool a harness.",
    },
    { role: "user", text: "Write them up so design can pick better labels." },
    {
      role: "agent",
      steps: [{ kind: "edit", target: "docs/first-run-review.md", added: 27, removed: 0 }],
      text: "Found two setup labels that need clearer language. The findings are ready for review.",
    },
  ],
};

/**
 * The conversation of a session: the hand-written script for its kind of work, opening with its real
 * prompt and closing with its real result. A session with no script gets just those two.
 */
export function transcriptOf(s: SessionItem): Turn[] {
  const script = SCRIPTS[s.title];
  if (!script) return [{ role: "user", text: s.prompt }, { role: "agent", text: s.result }];
  return script.map((t, i) => {
    if (i === 0 && t.role === "user") return { ...t, text: s.prompt };
    if (i === script.length - 1 && t.role === "agent") {
      // The script's last paragraph is replaced by the session's recorded result
      const parts = t.text.split("\n\n");
      return { ...t, text: [...parts.slice(0, -1), s.result].join("\n\n") };
    }
    return t;
  });
}
