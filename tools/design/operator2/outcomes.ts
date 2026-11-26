// What the work produced – Khaliq: "what did the prompts generate", "What is the artifact produced from it?
// If it's a PR would show that. If it's a Claude artifact or if it's still ongoing, they would show that."
//
// An artifact is anything a task's sessions made: a pull request, a document, a review, a Claude artifact.
// One artifact usually takes several sessions – one opens the PR, the next works in the review comments,
// a third fixes CI – so an artifact lists every session that worked on it. The fixtures record no
// artifacts, so these are sample data, built the same way on every load: a task's sessions on the same
// piece of work are grouped, in order, into artifacts of one to three sessions each; some sessions end
// without a result. The kind follows the work (documentation → a document, a review → a review).
import type { Initiative, Overview, SessionItem } from "../operator/model";

export type ArtifactKind = "pr" | "doc" | "review" | "claude";
export type ArtifactState = "merged" | "open" | "closed" | "published" | "draft";
export type Artifact = {
  id: string;
  kind: ArtifactKind;
  /** The PR's number; null for the other kinds */
  number: number | null;
  title: string;
  state: ArtifactState;
  /** Every session that worked on it, oldest first */
  sessions: SessionItem[];
};

export const KIND_LABEL: Record<ArtifactKind, string> = { pr: "Pull request", doc: "Document", review: "Review", claude: "Claude artifact" };
export const STATE_LABEL: Record<ArtifactState, string> = { merged: "Merged", open: "Open", closed: "Closed", published: "Published", draft: "Draft" };
/** Shipped: merged, or published – it's out. A plan is groundwork, not something shipped. */
export const shipped = (a: Artifact) => a.kind !== "claude" && (a.state === "merged" || a.state === "published");
/** A short name for tags: "PR #759", "Doc", "Review", "Artifact" */
export const shortName = (a: Artifact) => (a.kind === "pr" ? `PR #${a.number}` : a.kind === "doc" ? "Doc" : a.kind === "review" ? "Review" : "Artifact");

/** What later PRs on the same work are about */
const FOLLOW_UPS = ["follow-up fixes", "tests", "edge cases", "cleanup", "review feedback", "part 2"];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** What each kind of work turns into, and what its artifact is called */
function kindOf(title: string): { kind: ArtifactKind; name: (t: string) => string } {
  if (/^document|docs?\b/i.test(title)) return { kind: "doc", name: (t) => t.replace(/^document\s+/i, "").replace(/^./, (c) => c.toUpperCase()) + " guide" };
  if (/^review\b/i.test(title)) return { kind: "review", name: (t) => t.replace(/^review\s+/i, "").replace(/^./, (c) => c.toUpperCase()) + " review" };
  return { kind: "pr", name: (t) => t };
}

function build(task: Initiative): Artifact[] {
  const streams = new Map<string, SessionItem[]>();
  for (const s of task.sessions) streams.set(s.title, [...(streams.get(s.title) ?? []), s]);
  const out: Artifact[] = [];
  for (const [title, list] of streams) {
    const sessions = [...list].sort((a, b) => Date.parse(a.firstTs) - Date.parse(b.firstTs));
    const { kind, name } = kindOf(title);
    let chunk: SessionItem[] = [];
    let index = 0;
    // A document or a review is one thing that grows over its sessions; code ships as a series of PRs
    const single = kind !== "pr";
    const close = () => {
      if (!chunk.length) return;
      const first = chunk[0]!;
      const last = chunk.at(-1)!;
      const h = hash(first.id);
      // Longer work starts with a plan, written as a Claude artifact
      const k: ArtifactKind = kind === "pr" && index === 0 && sessions.length >= 4 ? "claude" : kind;
      const pr = k === "pr";
      const state: ArtifactState =
        k === "claude"
          ? "published"
          : last.status === "finished"
          ? pr ? "merged" : "published"
          : !single && last.status !== "active" && chunk.length > 1 && h % 5 === 0
            ? "closed"
            : pr ? "open" : "draft";
      out.push({
        id: `artifact-${first.id}`,
        kind: k,
        number: pr ? 400 + (h % 500) : null,
        title:
          k === "claude"
            ? `Plan: ${title.charAt(0).toLowerCase()}${title.slice(1)}`
            : pr && index > 1
              ? `${title}: ${FOLLOW_UPS[(index - 2) % FOLLOW_UPS.length]}`
              : name(title),
        state,
        sessions: chunk,
      });
      chunk = [];
      index++;
    };
    sessions.forEach((s) => {
      const h = hash(s.id);
      // A session that ended with nothing to show – it belongs to no artifact
      if (s.status === "idle" && h % 6 === 0) return;
      // A running session that starts something new hasn't produced anything yet
      if (s.status === "active" && !chunk.length) return;
      chunk.push(s);
      if (single) return;
      // The plan is one session on its own
      if (index === 0 && sessions.length >= 4) return close();
      // One to three sessions per PR; a finished session ships it
      const size = 1 + (hash(chunk[0]!.id) % 3);
      if (chunk.length >= size || s.status === "finished") close();
    });
    close();
  }
  return out.sort((a, b) => Date.parse(b.sessions.at(-1)!.lastTs) - Date.parse(a.sessions.at(-1)!.lastTs));
}

const BY_SESSION = new Map<string, Artifact>();
const BY_TASK = new Map<string, Artifact[]>();

/** Work out every task's artifacts for the data on screen – App calls this whenever the data changes */
export function registerArtifacts(data: Overview) {
  BY_SESSION.clear();
  BY_TASK.clear();
  for (const task of data.initiatives) {
    const list = build(task);
    BY_TASK.set(task.id, list);
    for (const a of list) for (const s of a.sessions) BY_SESSION.set(s.id, a);
  }
  return data;
}

/** The artifact a session worked on, if any */
export const artifactOf = (s: SessionItem): Artifact | null => BY_SESSION.get(s.id) ?? null;
/** Everything a task produced, newest first */
export const artifactsOf = (task: Initiative): Artifact[] => BY_TASK.get(task.id) ?? [];

/** A session's result: its artifact shipped, its artifact is waiting, it's still running, or nothing came of it */
export type Outcome = "merged" | "open" | "running" | "none";

export function outcomeOf(s: SessionItem): Outcome {
  if (s.status === "active") return "running";
  const a = artifactOf(s);
  if (!a || a.state === "closed") return "none";
  // A plan's session counts as done but not shipped
  return shipped(a) ? "merged" : "open";
}

export const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "merged", label: "Shipped" },
  { id: "open", label: "Waiting" },
  { id: "running", label: "Still running" },
  { id: "none", label: "No result" },
];

/** What one session did to its artifact, in a few words: "opened pull request #759", "updated the recovery guide" */
export function actionOf(a: Artifact, s: SessionItem) {
  const first = a.sessions[0]?.id === s.id;
  const last = a.sessions.at(-1)?.id === s.id;
  const what = a.kind === "pr" ? `pull request #${a.number}` : a.title;
  if (last && a.state === "merged") return `merged ${what}`;
  if (last && a.state === "published") return `${first ? "wrote and published" : "published"} ${what}`;
  if (last && a.state === "closed") return `closed ${what}`;
  if (first) return a.kind === "pr" ? `opened ${what}` : `${a.kind === "claude" ? "created" : "wrote a draft of"} ${what}`;
  return `updated ${what}`;
}

/** The task's artifacts by where they stand – what the result bar shows. Plans are counted apart. */
export type ArtifactGroup = "shipped" | "waiting" | "plan" | "closed";
export const ARTIFACT_GROUPS: { id: ArtifactGroup; label: string }[] = [
  { id: "shipped", label: "Shipped" },
  { id: "waiting", label: "Waiting" },
  { id: "plan", label: "Plans" },
  { id: "closed", label: "Closed" },
];
export const groupOf = (a: Artifact): ArtifactGroup => (a.kind === "claude" ? "plan" : a.state === "closed" ? "closed" : shipped(a) ? "shipped" : "waiting");
export const artifactCounts = (task: Initiative) => {
  const list = artifactsOf(task);
  return ARTIFACT_GROUPS.map((g) => ({ ...g, n: list.filter((a) => groupOf(a) === g.id).length }));
};
/** "2 of 6 shipped" – plans left out of both numbers */
export const shippedOf = (task: Initiative) => {
  const work = artifactsOf(task).filter((a) => a.kind !== "claude");
  return { shipped: work.filter(shipped).length, of: work.length };
};
