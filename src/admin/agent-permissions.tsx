// Hosted Cloud's AgentPermissions
// (packages/web/app/dashboard/settings/agent-permissions.tsx), on
// relay-control's delegation bindings routes: GET delegates/roles,
// GET|POST|PATCH|DELETE delegates/bindings and delegates/groups, and
// GET delegates/agents (v1 contract, the twin of Cloud's).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { adminApi, ApiError } from "./api";
import type { Binding, DelegationAgent, DelegationGroup, Preset, PrincipalKind, Recommendation } from "./contracts";
import { delegationCode, delegationError } from "./delegation-errors";
import { useLoad } from "./use-load";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "../shell/ui";
import { DelegatesSection, selectBase, selectClass, splitTargets, tableClass } from "./delegates-section";

type Access = "never" | "allow" | "ask";
type Area = "top" | "add" | "custom" | "groups" | "agents";

const EXPIRY_PRESETS = [7, 30, 90];
const REPO_HINT = "Use owner/repo or owner/* for repos.";
// A repo pattern the API refuses: a wildcard in the owner part (a star before the slash).
// owner/repo and owner/(star) are fine.
export function badRepoPattern(target: string): boolean {
  const slash = target.indexOf("/");
  return slash > 0 && target.slice(0, slash).includes("*");
}
/** Why an all-workspaces add skipped a workspace, in words. */
const SKIP_REASONS: Record<string, string> = {
  not_enabled: "delegation is off there",
  binding_exists: "it already has a row for this",
  forbidden: "you can't manage permissions there",
  unavailable: "it couldn't be reached; try that one again",
};
export function skippedNote(skipped: Array<{ workspace_id: string; reason: string }>): string {
  return `Not added in ${skipped.length} workspace${skipped.length === 1 ? "" : "s"}: ${skipped
    .map((item) => `${item.workspace_id} (${SKIP_REASONS[item.reason] ?? item.reason})`)
    .join("; ")}.`;
}
/**
 * Self-hosted relay-control reads no GitHub state, so an action whose role requires GitHub conditions
 * (merge needs checks to pass) is refused here (fail closed). Say so instead of promising it.
 */
const NEEDS_GITHUB = " (needs GitHub checks; not available on self-hosted)";
const EVERYTHING = "Everything I own";
const SOURCE_LABELS: Record<string, string> = {
  explicit_grant: "Its own grant",
  agent: "Its own setting",
  group: "A custom group",
  connector_kind: "Its connector group",
  relay_agents: "Relay agents",
  spawn_default: "Started by another agent: Read-only",
  none: "Nothing: no access",
};

/** The expiry a preset sends, from the moment it is called (only in event handlers). */
function expiresAt(days: string | null): string | undefined {
  return days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : undefined;
}

/** A "Who" choice: a group id from GET groups, or `agent:<id>` for one agent from GET agents. */
export function principalFor(who: string): { kind: PrincipalKind; ref?: string } {
  if (who.startsWith("agent:")) return { kind: "agent", ref: who.slice("agent:".length) };
  if (who === "relay_agents") return { kind: "relay_agents" };
  if (who.startsWith("connector:")) return { kind: "connector_kind", ref: who.slice("connector:".length) };
  return { kind: "group", ref: who };
}

/** An error whose message the panel shows as is (a conversion offer, a half-done exclusion). */
class ShownError extends Error {}

/** A small disclosure: a button that shows or hides what follows it. */
function Disclosure(props: { open: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-expanded={props.open}
      onClick={props.onToggle}
      className={`flex min-w-0 items-start justify-start gap-2 whitespace-normal border-0 bg-transparent p-0 text-left font-normal shadow-none ${props.className ?? ""}`}
    >
      <span aria-hidden className={`mt-0.5 inline-block w-3 transition-transform ${props.open ? "rotate-90" : ""}`}>›</span>
      {props.children}
    </button>
  );
}

/**
 * Who may act for you (owner-trusted delegation as bindings): a short table of who (Relay agents, a
 * custom group or one agent) has which role, on what, until when. Preset roles, their wording and the
 * recommended setup come from relay-control (GET delegates/roles and delegates/bindings). Advanced
 * holds custom permissions, connector groups, specific repos, groups, the per-agent "which setting
 * decides" view with exclusion, and the explicit-grant table (claims, revoke everything).
 *
 * Render it keyed by workspace id (DelegationSection is): a request still in flight for the old
 * workspace is dropped, and useLoad applies only the newest answer.
 */
export function AgentPermissions(props: {
  workspaceId: string;
  delegationEnabled: boolean;
  maxExpiryDays: number;
  isAdmin: boolean;
  /** A new value re-reads (a grant or the trust rule changed elsewhere on the page). */
  refreshKey?: number;
  /** Called after a binding or group changed, so the trust rule card and the grants re-read. */
  onChanged?: () => void;
  /** Passed to the explicit-grant table. */
  grantsRefreshKey?: number;
  onGrantsChanged?: () => void;
}) {
  const { workspaceId, delegationEnabled, refreshKey = 0 } = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { data: view, error: loadError, reload } = useLoad(async (signal) => {
    const [roles, bindings, groups, agents] = await Promise.all([
      adminApi.delegationRoles(workspaceId, signal),
      adminApi.delegationBindings(workspaceId, signal),
      adminApi.delegationGroups(workspaceId, signal),
      // The agent list needs messaging (it can answer 503 while messaging is down): without it the rest still works.
      adminApi.delegationAgents(workspaceId, signal).then(
        (list) => ({ list, unavailable: null as string | null }),
        (failure: unknown) => ({ list: [] as DelegationAgent[], unavailable: delegationError(failure, "Could not list your agents.") }),
      ),
    ]);
    return { roles, bindings: bindings.bindings, recommendation: bindings.recommendation as Recommendation, groups,
      agents: agents.list, agentsUnavailable: agents.unavailable };
  });
  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (seenRefresh !== refreshKey) {
    setSeenRefresh(refreshKey);
    reload();
  }
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ area: Area; text: string; error: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // While a rule from before roles is live, adding Relay agents answers binding_exists with that rule's id:
  // offer to convert it (a PATCH to Trusted) instead.
  const [convertId, setConvertId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "binding"; binding: Binding } | { kind: "group"; group: DelegationGroup } | null>(null);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState("relay_agents");
  const [role, setRole] = useState("");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  // The custom form has its own expiry and workspace choice, so a cancelled simple draft never carries over.
  const [customExpiry, setCustomExpiry] = useState<string | null>(null);
  const [customAllWorkspaces, setCustomAllWorkspaces] = useState(false);
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [custom, setCustom] = useState<{ who: string; access: Record<string, Access>; commentsOnly: boolean }>({
    who: "relay_agents",
    access: {},
    commentsOnly: false,
  });
  const [targetChips, setTargetChips] = useState<string[]>([]);
  const [targetDraft, setTargetDraft] = useState("");
  const [newGroup, setNewGroup] = useState<{ name: string; agents: string[] }>({ name: "", agents: [] });
  // The agent picked to add to each custom group, added only on the Add button (not on every keyboard step).
  const [groupPick, setGroupPick] = useState<Record<string, string>>({});
  // The row the editor is saving now: its own reload must not count as someone else changing the row.
  const [savingEdit, setSavingEdit] = useState<string | null>(null);
  // Editing a saved row in place: its role, or (for Custom) each action; its repos and expiry.
  const [editing, setEditing] = useState<{
    binding: Binding;
    role: string;
    access: Record<string, Access>;
    commentsOnly: boolean;
    startCommentsOnly: boolean;
    repos: string;
    expiry: string;
  } | null>(null);

  const presets: Preset[] = view?.roles.presets ?? [];
  const advancedShown = advancedOpen || (!view && Boolean(loadError));
  const presetLabel = (value: string | null) =>
    value === null || value === "none" ? "No access"
      : value === "custom" ? "Custom"
      : value === "excluded" ? "Excluded: no access"
        // A rule from before roles existed reads as "legacy" (every class) until it is seeded; changing it must name a role.
        : value === "legacy" ? "All actions (set before roles)"
          : presets.find((preset) => preset.role === value)?.label ?? value;
  const classDescription = (value: string) => view?.roles.classes.find((item) => item.class === value)?.description ?? value;
  const chosenRole = role || presets[0]?.role || "";
  const setError = (area: Area, text: string) => setFeedback({ area, text, error: true });
  const setNotice = (area: Area, text: string) => setFeedback({ area, text, error: false });
  const message = (area: Area) =>
    feedback?.area === area ? (
      feedback.error ? (
        <p role="alert" className="text-sm text-destructive">{feedback.text}</p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{feedback.text}</p>
      )
    ) : null;
  const failure = (error: unknown, fallback: string) => {
    if (error instanceof ShownError) return error.message;
    const code = delegationCode(error);
    if (code === "binding_exists") return "There is already a row for this. Change its role in the table instead.";
    if (code === "not_owned") return "That agent is not one of yours. Connect it first (Advanced › Explicit grants).";
    return delegationError(error, fallback);
  };

  /**
   * Runs one write; answers whether it changed something (then re-reads and tells the page). Errors show
   * in `area`; the success notice in `noticeArea` (a successful add closes its form).
   */
  const run = async (area: Area, work: () => Promise<string | void>, noticeArea: Area = area): Promise<boolean> => {
    setPending(true);
    setFeedback(null);
    try {
      const done = await work();
      if (!mounted.current || done === undefined) return false;
      setNotice(noticeArea, done);
      reload();
      props.onChanged?.();
      return true;
    } catch (error) {
      if (mounted.current) setError(area, failure(error, "Could not save. Try again."));
      return false;
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  const create = (area: Area, body: Record<string, unknown>, done: string) =>
    run(area, async () => {
      try {
        const answer = await adminApi.createDelegationBinding(workspaceId, body);
        // Every workspace skipped: nothing was added, so keep the draft and say why.
        if (!answer.binding && !answer.bindings?.length && answer.skipped.length) {
          throw new ShownError(`Nothing was added. ${skippedNote(answer.skipped)}`);
        }
        // Some workspaces of an all-workspaces add can be skipped (one may even have failed) while the rest were added.
        return answer.skipped.length ? `${done} ${skippedNote(answer.skipped)}` : done;
      } catch (error) {
        const conflict = error instanceof ApiError ? (error.body as { binding_id?: unknown } | null)?.binding_id : undefined;
        // Offer converting only a rule from before roles; any other existing row is an ordinary duplicate.
        const conflictRow = typeof conflict === "string" ? view?.bindings.find((binding) => binding.binding_id === conflict) : undefined;
        if (delegationCode(error) === "binding_exists" && conflictRow?.role === "legacy" && typeof conflict === "string") {
          setConvertId(conflict);
          throw new ShownError("Your existing trust rule already covers your Relay agents. Convert it to Trusted instead.");
        }
        const bad400 = error instanceof ApiError && error.status === 400;
        const targets = (body.targets as string[] | undefined) ?? [];
        // A repo pattern with a wildcard owner is refused with 400; so is every workspace at once without a browser session.
        if (bad400 && targets.some(badRepoPattern)) throw new ShownError(REPO_HINT);
        if (bad400 && body.all_workspaces) {
          throw new ShownError("Adding to every workspace in this organization needs you signed in here in the browser. Untick it to add it to this workspace only.");
        }
        throw error;
      }
    }, area === "add" ? "top" : area);
  /** Converts a rule from before roles to Trusted (it already covers the Relay agents). */
  const convert = (bindingId: string) =>
    run("top", async () => {
      await adminApi.updateDelegationBinding(workspaceId, bindingId, { role: "trusted" });
      setConvertId(null);
      return "Your existing rule is now Trusted.";
    });
  // A rule from before roles: the API sends it with role "legacy" (and principal kind "all_agents").
  const legacyRelay = view?.bindings.find((binding) => binding.role === "legacy");
  const patch = (area: Area, binding: Binding, body: Record<string, unknown>, done: string) =>
    run(area, async () => {
      await adminApi.updateDelegationBinding(workspaceId, binding.binding_id, body);
      return done;
    });

  /** "All workspaces" covers built-in groups only (Relay agents, a connector group). */
  const bulkEligible = (value: string) => value === "relay_agents" || value.startsWith("connector:");
  /** The Who values offered now; a draft whose principal disappeared (a deleted group) must be chosen again. */
  const whoValues = (withConnectors: boolean) => new Set([
    ...(view?.groups.some((group) => group.group_id === "relay_agents") ? ["relay_agents"] : []),
    ...(withConnectors ? (view?.groups ?? []).filter((group) => group.group_id.startsWith("connector:")).map((group) => group.group_id) : []),
    ...(view?.groups ?? []).filter((group) => group.kind === "custom").map((group) => group.group_id),
    ...(view?.agents ?? []).map((agent) => `agent:${agent.agent_id}`),
  ]);
  const whoOk = whoValues(false).has(who);
  const customWhoOk = whoValues(true).has(custom.who);

  const addSimple = async () => {
    const added = await create(
      "add",
      {
        principal: principalFor(who),
        role: chosenRole,
        ...(expiry ? { expires_at: expiresAt(expiry) } : {}),
        ...(allWorkspaces && bulkEligible(who) ? { all_workspaces: true } : {}),
      },
      "Added.",
    );
    // A refused add keeps the form as filled, with its error.
    if (!added) return;
    setAdding(false);
    setWho("relay_agents");
    setRole("");
    setExpiry(null);
    setAllWorkspaces(false);
  };

  const targetList = [...targetChips, ...targetDraft.split(/\s+/u).filter(Boolean)];
  const targetProblem = targetList.some((target) => target.endsWith(","))
    ? "Separate repos with spaces, not commas: a comma is kept as part of the repo."
    : targetList.some(badRepoPattern)
      ? REPO_HINT
      : null;
  const customAllowed = Object.entries(custom.access).filter(([, access]) => access === "allow").map(([item]) => item);
  const customAsk = Object.entries(custom.access).filter(([, access]) => access === "ask").map(([item]) => item);
  const customValid = customAllowed.length + customAsk.length > 0 && !targetProblem && customWhoOk;
  const addCustom = async () => {
    const added = await create(
      "custom",
      {
        principal: principalFor(custom.who),
        role: "custom",
        classes: [...customAllowed, ...customAsk],
        require_tier_o: customAsk,
        // The comments-only limit applies only while PR work is allowed or asks first.
        ...(custom.commentsOnly && (customAllowed.includes("pr_ops") || customAsk.includes("pr_ops")) ? { pr_ops_limit: ["comment"] } : {}),
        ...(targetList.length ? { targets: targetList } : {}),
        ...(customExpiry ? { expires_at: expiresAt(customExpiry) } : {}),
        ...(customAllWorkspaces && bulkEligible(custom.who) ? { all_workspaces: true } : {}),
      },
      "Added a custom permission.",
    );
    if (!added) return;
    setCustom((current) => ({ ...current, access: {}, commentsOnly: false }));
    setTargetChips([]);
    setTargetDraft("");
    setCustomExpiry(null);
    setCustomAllWorkspaces(false);
  };

  /**
   * Opens the editor on a saved row, filled from what it allows now. Excluded and legacy rows are not
   * edited here (removing the row, or the convert offer, covers them), so nothing is lifted by accident.
   */
  const startEdit = (binding: Binding) => {
    const access: Record<string, Access> = {};
    for (const item of binding.classes) access[item] = binding.require_tier_o.includes(item) ? "ask" : "allow";
    // Comments-only means exactly ["comment"]; any other PR work limit is kept as it is unless changed.
    const commentsOnly = binding.pr_ops_limit?.length === 1 && binding.pr_ops_limit[0] === "comment";
    setConfirm(null);
    setFeedback(null);
    setEditing({
      binding,
      role: binding.role,
      access,
      commentsOnly,
      startCommentsOnly: commentsOnly,
      repos: (binding.targets ?? []).join(" "),
      expiry: "keep",
    });
  };
  const editable = (binding: Binding) => binding.role !== "excluded" && binding.role !== "legacy";
  // Repos as a set: a repeated entry is one repo.
  const editRepos = [...new Set((editing?.repos ?? "").split(/\s+/u).filter(Boolean))];
  const editAllowed = Object.entries(editing?.access ?? {}).filter(([, access]) => access === "allow").map(([item]) => item);
  const editAsked = Object.entries(editing?.access ?? {}).filter(([, access]) => access === "ask").map(([item]) => item);
  const editClasses = [...editAllowed, ...editAsked];
  const sameSet = (a: readonly string[], b: readonly string[]) => {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((item) => right.has(item));
  };
  // Another control changed (or removed) the row being edited: the draft is stale, so it is closed rather
  // than saved back over the newer row.
  const editedNow = editing && view ? view.bindings.find((item) => item.binding_id === editing.binding.binding_id) : undefined;
  if (
    editing && view && savingEdit !== editing.binding.binding_id
    && (!editedNow
      || editedNow.role !== editing.binding.role
      || !sameSet(editedNow.classes, editing.binding.classes)
      || !sameSet(editedNow.require_tier_o, editing.binding.require_tier_o)
      || !sameSet(editedNow.targets ?? [], editing.binding.targets ?? [])
      || (editedNow.expires_at ?? null) !== (editing.binding.expires_at ?? null)
      || JSON.stringify(editedNow.pr_ops_limit ?? null) !== JSON.stringify(editing.binding.pr_ops_limit ?? null)
      || JSON.stringify(editedNow.required_conditions ?? null) !== JSON.stringify(editing.binding.required_conditions ?? null))
  ) {
    setEditing(null);
    setNotice("top", "That row changed while you were editing it. Open Edit again to change it.");
  }
  // The row's own conditions (merge needs checks to pass): carried along, never dropped silently.
  const editConditions = editing?.binding.required_conditions ?? null;
  // Shown as kept only for actions still chosen (a Custom edit can set an action to Never).
  const conditionsShown = Object.entries(editConditions ?? {}).filter(
    ([item, list]) => list.length && (editing?.role !== "custom" || editClasses.includes(item)),
  );
  const editProblem = !editing
    ? null
    : editRepos.some((target) => target.endsWith(","))
      ? "Separate repos with spaces, not commas: a comma is kept as part of the repo."
      : editRepos.some(badRepoPattern)
        ? REPO_HINT
        : editing.role === "custom" && !editClasses.length
          ? "Choose at least one action."
          : editing.role === "custom" && editing.binding.role !== "custom" && editing.binding.required_conditions === undefined
            ? "This row's conditions can't be read here, so switching it to Custom would drop them. Remove it and add a custom permission instead."
            : null;
  /**
   * Saves the editor as one PATCH of the same row, sending only what changed: the role only when it
   * changes (re-sending a preset would re-resolve it from today's presets), the actions with their
   * conditions only when they change, the PR work limit only when its checkbox changed.
   */
  const saveEdit = async () => {
    if (!editing || editProblem) return;
    const binding = editing.binding;
    const roleChanged = editing.role !== binding.role;
    const custom = editing.role === "custom";
    const classesChanged = custom && (roleChanged || !sameSet(editClasses, binding.classes) || !sameSet(editAsked, binding.require_tier_o));
    const prWork = editClasses.includes("pr_ops");
    const conditions = Object.fromEntries(Object.entries(editConditions ?? {}).filter(([item]) => editClasses.includes(item)));
    const targets = editRepos.length ? editRepos : null;
    // Null and an empty list both mean everything I own.
    const targetsChanged = !sameSet(targets ?? [], binding.targets ?? []);
    const limitChanged = custom && editing.commentsOnly !== editing.startCommentsOnly;
    const body: Record<string, unknown> = {
      ...(roleChanged ? { role: editing.role } : {}),
      // Conditions the server didn't send are left to it (an existing Custom row keeps them), never sent as none.
      ...(classesChanged
        ? { classes: editClasses, require_tier_o: editAsked,
          ...(binding.required_conditions === undefined ? {} : { required_conditions: conditions }) }
        : {}),
      // Whenever the actions change (a switch to Custom included) the limit is sent too, or the server would
      // store none: the box's choice when it changed, else the row's own limit while PR work stays on.
      ...(classesChanged || limitChanged
        ? { pr_ops_limit: !prWork ? null : limitChanged ? (editing.commentsOnly ? ["comment"] : null) : (binding.pr_ops_limit ?? null) }
        : {}),
      ...(targetsChanged ? { targets } : {}),
      ...(editing.expiry === "keep" ? {} : { expires_at: editing.expiry === "never" ? null : expiresAt(editing.expiry) }),
    };
    if (!Object.keys(body).length) {
      setEditing(null);
      setNotice("top", "Nothing changed.");
      return;
    }
    setSavingEdit(binding.binding_id);
    // Cleared however the save ends: a stuck marker would stop a later change to this row from closing the draft.
    try {
      if (await patch("top", binding, body, `Saved ${binding.principal.name}.`)) setEditing(null);
    } finally {
      setSavingEdit(null);
    }
  };

  const remove = () => {
    const what = confirm;
    setConfirm(null);
    if (!what) return;
    return run("top", async () => {
      if (what.kind === "binding") {
        await adminApi.deleteDelegationBinding(workspaceId, what.binding.binding_id);
        return "Removed.";
      }
      await adminApi.deleteDelegationGroup(workspaceId, what.group.group_id);
      return `Deleted ${what.group.name}.`;
    });
  };

  /**
   * No access for one agent: its own setting becomes "excluded". An explicit grant wins over every
   * setting, so an agent decided by its own grant also has that grant revoked, after the exclusion is
   * written: in between the grant still wins, so access never widens. If that revoke fails, the agent
   * keeps its own grant, and the error says so.
   */
  const exclude = (agent: DelegationAgent) =>
    run("agents", async () => {
      // Read what decides the agent now: a grant added since the table rendered must be revoked too.
      const fresh = await adminApi.delegationAgents(workspaceId).catch(() => null);
      const unchecked = fresh === null;
      const current = fresh?.find((item) => item.agent_id === agent.agent_id) ?? agent;
      const grantId = current.effective.source === "explicit_grant" ? current.effective.grant_id : null;
      const own = view?.bindings.find((binding) => binding.principal.kind === "agent" && binding.principal.ref === agent.agent_id);
      if (own) await adminApi.updateDelegationBinding(workspaceId, own.binding_id, { role: "excluded" });
      else await adminApi.createDelegationBinding(workspaceId, { principal: { kind: "agent", ref: agent.agent_id }, role: "excluded" });
      if (grantId) {
        try {
          await adminApi.revokeDelegateGrant(workspaceId, grantId);
        } catch (error) {
          // The exclusion is written: re-read and tell the page, and say the agent still acts on its own grant.
          if (mounted.current) {
            reload();
            props.onChanged?.();
          }
          throw new ShownError(
            `${agent.name} is excluded, but its own grant could not be revoked, so it still acts on that grant: ${failure(error, "Could not save. Try again.")}`,
          );
        }
        props.onGrantsChanged?.();
      }
      // Without a fresh read a grant added since render may still apply: never claim access is gone.
      if (unchecked && !grantId) {
        if (mounted.current) {
          reload();
          props.onChanged?.();
        }
        throw new ShownError(`${agent.name} is excluded, but whether it still has its own grant couldn't be checked. Look under Explicit grants.`);
      }
      return grantId ? `${agent.name} has no access now; its own grant was revoked.` : `${agent.name} has no access now.`;
    });


  const typeTargets = (text: string) => {
    const { done, draft } = splitTargets(text);
    if (done.length) setTargetChips((chips) => [...chips, ...done]);
    setTargetDraft(draft);
  };
  const targetKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && targetDraft.trim()) {
      event.preventDefault();
      typeTargets(`${targetDraft} `);
    } else if (event.key === "Backspace" && !targetDraft && targetChips.length) {
      setTargetChips((chips) => chips.slice(0, -1));
    }
  };

  const id = (name: string) => `permissions-${name}-${workspaceId}`;
  const relayGroup = view?.groups.find((group) => group.group_id === "relay_agents");
  const customGroups = view?.groups.filter((group) => group.kind === "custom") ?? [];
  const connectorGroups = view?.groups.filter((group) => group.group_id.startsWith("connector:")) ?? [];
  const whoHint = (binding: Binding) => {
    const count = `${binding.covered} agent${binding.covered === 1 ? "" : "s"}`;
    if (binding.principal.kind === "agent") return "One agent";
    if (binding.principal.kind === "relay_agents") return `${count} · new connected agents join automatically · your trust rule`;
    if (binding.role === "legacy") return "Your trust rule, set before roles";
    return binding.principal.kind === "connector_kind" ? `${count} · new connected agents join automatically` : count;
  };
  /** What a custom row allows, asks first for, and how PR work is limited. */
  const customSummary = (binding: Binding) => {
    const allowed = binding.classes.filter((item) => !binding.require_tier_o.includes(item))
      .map((item) => (item === "pr_ops" && binding.pr_ops_limit ? `pr_ops (only: ${binding.pr_ops_limit.join(", ")})` : item));
    return [allowed.length ? `Does: ${allowed.join(", ")}` : null,
      binding.require_tier_o.length ? `asks first: ${binding.require_tier_o.join(", ")}` : null].filter(Boolean).join("; ");
  };
  const whoOptions = (withConnectors: boolean) => (
    <>
      {relayGroup ? <option value="relay_agents">{relayGroup.name}</option> : null}
      {withConnectors ? connectorGroups.map((group) => <option key={group.group_id} value={group.group_id}>{group.name}</option>) : null}
      {customGroups.map((group) => <option key={group.group_id} value={group.group_id}>{group.name}</option>)}
      {(view?.agents ?? []).map((agent) => (
        <option key={agent.agent_id} value={`agent:${agent.agent_id}`}>{`${agent.name} (${agent.agent_id})`}</option>
      ))}
    </>
  );
  const expiryControl = (value: string | null, set: (next: string | null) => void, name: string) =>
    value === null ? (
      <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={pending} onClick={() => set("30")}>
        Set expiry
      </Button>
    ) : (
      <span className="flex items-center gap-2">
        <label htmlFor={id(name)} className="text-sm">Expires after</label>
        <select id={id(name)} className={`${selectBase} w-28`} value={value} disabled={pending} onChange={(event) => set(event.target.value)}>
          {EXPIRY_PRESETS.map((days) => (
            <option key={days} value={String(days)}>{`${days} days`}</option>
          ))}
        </select>
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => set(null)}>Never</Button>
      </span>
    );
  const allWorkspacesControl = (value: boolean, set: (next: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" checked={value} disabled={pending} onChange={(event) => set(event.target.checked)} />
      Apply to all workspaces in this organization
    </label>
  );
  const roleLists = (preset: Preset) => {
    const needsGithub = (item: string) => (preset.required_conditions?.[item]?.length ? NEEDS_GITHUB : "");
    const allowed = preset.classes
      .filter((item) => !preset.require_tier_o.includes(item))
      .map((item) =>
        (item === "pr_ops" && preset.pr_ops_limit ? `${classDescription(item)} (only: ${preset.pr_ops_limit.join(", ")})` : classDescription(item)) +
        needsGithub(item));
    const asked = preset.require_tier_o.map((item) => classDescription(item) + needsGithub(item));
    const never = (view?.roles.classes ?? [])
      .filter((item) => !preset.classes.includes(item.class) && !preset.require_tier_o.includes(item.class))
      .map((item) => item.description);
    const columns: Array<[string, string[]]> = [
      ["Does without asking", allowed],
      ["Asks you first", asked],
      ["Never", never],
    ];
    return (
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        {columns.map(([title, entries]) => (
          <div key={title}>
            <p className="font-medium">{title}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {entries.length ? entries.map((entry) => <li key={entry}>{entry}</li>) : <li>Nothing</li>}
            </ul>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent permissions</CardTitle>
        <CardDescription>Decide what your agents may approve for you.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {delegationError(loadError, "Could not load agent permissions.")}{" "}
            <Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button>
          </p>
        ) : null}
        {!view ? (
          loadError ? null : <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            {view.recommendation && !dismissed && delegationEnabled ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] p-4">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{`Recommended: ${view.recommendation.label}`}</p>
                  <p className="text-sm text-muted-foreground">{presets.find((preset) => preset.role === view.recommendation?.role)?.description}</p>
                  {Object.values(presets.find((preset) => preset.role === view.recommendation?.role)?.required_conditions ?? {}).some((list) => list.length) ? (
                    <p className="text-xs text-muted-foreground">
                      Merges need GitHub checks, which this self-hosted install can&apos;t read, so delegated merges are refused here.
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(true)}>Not now</Button>
                  {view.recommendation.binding_id || legacyRelay ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => void convert((view.recommendation?.binding_id || legacyRelay?.binding_id)!)}
                    >
                      Convert your existing rule to Trusted
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        const recommendation = view.recommendation!;
                        void create("top", { principal: recommendation.principal, role: recommendation.role }, `Applied: ${recommendation.label}.`);
                      }}
                    >
                      Apply
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
            {convertId && delegationEnabled ? (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] p-3"
                role="group"
                aria-label="Convert existing rule"
              >
                <p className="text-sm">Your existing trust rule already covers your Relay agents.</p>
                <Button type="button" size="sm" disabled={pending} onClick={() => void convert(convertId)}>
                  Convert your existing rule to Trusted
                </Button>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold">Who can act for you</h4>
                {delegationEnabled && !adding ? (
                  <Button type="button" size="sm" disabled={pending} onClick={() => { setAdding(true); setFeedback(null); }}>
                    Add permission
                  </Button>
                ) : null}
              </div>
              {adding && delegationEnabled ? (
                <form
                  className="grid gap-3 rounded-lg border border-[var(--border-default)] p-3 sm:grid-cols-[1.4fr_1fr_1fr]"
                  aria-label="Add permission"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (chosenRole && whoOk) void addSimple();
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={id("who")} className="text-sm font-medium">Who</label>
                    <select id={id("who")} className={selectClass} value={whoOk ? who : ""} disabled={pending} onChange={(event) => setWho(event.target.value)}>
                      <option value="" disabled>Choose who</option>
                      {whoOptions(false)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={id("role")} className="text-sm font-medium">Role</label>
                    <select id={id("role")} className={selectClass} value={chosenRole} disabled={pending} onChange={(event) => setRole(event.target.value)}>
                      {presets.map((preset) => <option key={preset.role} value={preset.role}>{preset.label}</option>)}
                    </select>
                    <p className="text-xs text-muted-foreground">{presets.find((preset) => preset.role === chosenRole)?.description}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Scope</span>
                    <p className="flex h-9 items-center text-sm">{EVERYTHING}</p>
                    <p className="text-xs text-muted-foreground">Specific repos: Advanced</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
                    <div className="flex flex-wrap items-center gap-4">{expiryControl(expiry, setExpiry, "expiry")}{bulkEligible(who) ? allWorkspacesControl(allWorkspaces, setAllWorkspaces) : null}</div>
                    <div className="flex items-center gap-2">
                      {message("add")}
                      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setAdding(false); setFeedback(null); }}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={pending || !chosenRole || !whoOk}>Add</Button>
                    </div>
                  </div>
                </form>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
                <table className={tableClass} aria-label="Agent permissions">
                  <thead>
                    <tr>
                      <th>Who</th>
                      <th>Role</th>
                      <th>Scope</th>
                      <th>Expires</th>
                      <th><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.bindings.map((binding) => (
                      <tr key={binding.binding_id}>
                        <td>
                          <span className={binding.principal.kind === "agent" ? "font-mono" : "font-medium"}>{binding.principal.name}</span>
                          <span className="block text-xs text-muted-foreground">{whoHint(binding)}</span>
                        </td>
                        <td>
                          {delegationEnabled ? (
                            <select
                              className={`${selectBase} w-44`}
                              aria-label={`Role for ${binding.principal.name}`}
                              value={binding.role}
                              disabled={pending}
                              onChange={(event) =>
                                void patch("top", binding, { role: event.target.value },
                                  `Changed to ${presetLabel(event.target.value)}. Approvals made under the old role were ended.`)
                              }
                            >
                              {presets.map((preset) => <option key={preset.role} value={preset.role}>{preset.label}</option>)}
                              {binding.role === "custom" || binding.role === "excluded" || binding.role === "legacy" ? (
                                <option value={binding.role} disabled>{presetLabel(binding.role)}</option>
                              ) : null}
                            </select>
                          ) : (
                            presetLabel(binding.role)
                          )}
                          {binding.role === "custom" ? (
                            <span className="block text-xs text-muted-foreground">{customSummary(binding)}</span>
                          ) : null}
                          {binding.clipped_by_policy.length ? (
                            <span className="block text-xs text-muted-foreground">{`Workspace policy blocks: ${binding.clipped_by_policy.join(", ")}`}</span>
                          ) : null}
                        </td>
                        <td>
                          {binding.targets?.length ? (
                            <span className="font-mono text-xs">{binding.targets.join(" ")}</span>
                          ) : (
                            <span className="whitespace-nowrap">{EVERYTHING}</span>
                          )}
                        </td>
                        <td>{binding.expires_at ? new Date(binding.expires_at).toLocaleDateString() : "Never"}</td>
                        <td className="text-right">
                          <div className="flex justify-end gap-2">
                            {delegationEnabled && editable(binding) ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                aria-label={`Edit ${binding.principal.name}`}
                                onClick={() => startEdit(binding)}
                              >
                                Edit
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              aria-label={`Remove ${binding.principal.name}`}
                              onClick={() => setConfirm({ kind: "binding", binding })}
                            >
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {view.bindings.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-muted-foreground">No agent can act for you yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {editing && delegationEnabled ? (
                <form
                  className="flex flex-col gap-3 rounded-lg border border-[var(--border-default)] p-3"
                  aria-label="Edit permission"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveEdit();
                  }}
                >
                  <p className="text-sm font-medium">{`Edit ${editing.binding.principal.name}`}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={id("edit-role")} className="text-sm font-medium">Role</label>
                      <select
                        id={id("edit-role")}
                        className={selectClass}
                        value={editing.role}
                        disabled={pending}
                        onChange={(event) => setEditing((current) => current && { ...current, role: event.target.value })}
                      >
                        {presets.map((preset) => <option key={preset.role} value={preset.role}>{preset.label}</option>)}
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={id("edit-repos")} className="text-sm font-medium">Repos</label>
                      <Input
                        id={id("edit-repos")}
                        value={editing.repos}
                        disabled={pending}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={`${EVERYTHING} (or owner/repo owner/*)`}
                        onChange={(event) => setEditing((current) => current && { ...current, repos: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={id("edit-expiry")} className="text-sm font-medium">Expires</label>
                      <select
                        id={id("edit-expiry")}
                        className={selectClass}
                        value={editing.expiry}
                        disabled={pending}
                        onChange={(event) => setEditing((current) => current && { ...current, expiry: event.target.value })}
                      >
                        <option value="keep">
                          {editing.binding.expires_at ? `Keep (${new Date(editing.binding.expires_at).toLocaleDateString()})` : "Keep (never)"}
                        </option>
                        <option value="never">Never</option>
                        {EXPIRY_PRESETS.map((days) => <option key={days} value={String(days)}>{`${days} days from now`}</option>)}
                      </select>
                    </div>
                  </div>
                  {editing.role === "custom" ? (
                    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      {view.roles.classes.map((item) => (
                        <label key={item.class} className="flex items-center justify-between gap-3 text-sm">
                          <span>{item.description}</span>
                          <select
                            className={`${selectBase} w-36`}
                            aria-label={`Edit ${item.description}`}
                            value={editing.access[item.class] ?? "never"}
                            disabled={pending}
                            onChange={(event) =>
                              setEditing((current) => current && { ...current, access: { ...current.access, [item.class]: event.target.value as Access } })
                            }
                          >
                            <option value="never">Never</option>
                            <option value="allow">Allowed</option>
                            <option value="ask">Ask me first</option>
                          </select>
                        </label>
                      ))}
                      {editing.access.pr_ops && editing.access.pr_ops !== "never" ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={editing.commentsOnly}
                            disabled={pending}
                            onChange={(event) => setEditing((current) => current && { ...current, commentsOnly: event.target.checked })}
                          />
                          Pull request work: comments only
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {conditionsShown.length ? (
                    <p className="text-xs text-muted-foreground">
                      {`Conditions kept: ${conditionsShown
                        .map(([item, list]) => `${item} only when ${list.map((condition) => (condition.type === "ci_green" ? "checks pass" : condition.type)).join(" and ")}`)
                        .join("; ")}.`}
                    </p>
                  ) : null}
                  {editProblem ? <p role="alert" className="text-xs text-destructive">{editProblem}</p> : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={pending || Boolean(editProblem)}>Save</Button>
                  </div>
                </form>
              ) : null}
              {confirm ? (
                <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] p-3" role="group" aria-label="Confirm removal">
                  <p className="text-sm">
                    {confirm.kind === "binding"
                      ? confirm.binding.role === "excluded"
                        ? `Remove the exclusion for ${confirm.binding.principal.name}? Its broader setting (a group or Relay agents) applies again, so it can act for you again.`
                        : `Remove ${confirm.binding.principal.name}? Approvals it made under this row stop working at once. The agents it covered fall back to their next setting (a group or Relay agents), which can give them access again.`
                      : `Delete ${confirm.group.name}? Its permission rows are removed and approvals made under them stop working. Its agents fall back to their next setting (another group or Relay agents), which can give them access again.`}
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => void remove()}>
                      {confirm.kind === "binding" ? "Remove" : "Delete group"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
                  </div>
                </div>
              ) : null}
              {message("top")}
              <p className="text-xs text-muted-foreground">
                The most specific setting wins: an agent&apos;s own grant, then its own setting, then a custom group, then Relay agents. Agents
                your agents start keep their own permissions: Read-only unless you add them to a group.
                {delegationEnabled ? "" : " Delegation is off, so nothing can be added; you can still remove rows."}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">Roles</h4>
              <ul className="flex flex-col divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)]">
                {presets.map((preset) => (
                  <li key={preset.role} className="p-3">
                    <Disclosure open={openRole === preset.role} onToggle={() => setOpenRole(openRole === preset.role ? null : preset.role)} className="w-full">
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{preset.label}</span>
                        <span className="text-sm text-muted-foreground">{preset.description}</span>
                      </span>
                    </Disclosure>
                    {openRole === preset.role ? <div className="mt-3 pl-5">{roleLists(preset)}</div> : null}
                  </li>
                ))}
              </ul>
            </div>

          </>
        )}

        {/* Always rendered, outside the binding reads: the explicit grants and Revoke everything must stay
            reachable while roles, bindings or groups fail. An outage opens it. */}
            <div className="flex flex-col gap-4">
              <Disclosure open={advancedShown} onToggle={() => setAdvancedOpen(!advancedShown)} className="text-sm font-medium text-muted-foreground">
                Advanced
              </Disclosure>
              {advancedShown ? (
                <div className="flex flex-col gap-6">
                  {view ? (
                    <>
                  {delegationEnabled ? (
                    <section className="flex flex-col gap-3" aria-labelledby={id("custom-heading")}>
                      <h4 id={id("custom-heading")} className="text-sm font-semibold">Custom permission</h4>
                      <form
                        className="flex flex-col gap-3"
                        aria-label="Add a custom permission"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (customValid) void addCustom();
                        }}
                      >
                        <div className="flex flex-col gap-1.5 sm:max-w-sm">
                          <label htmlFor={id("custom-who")} className="text-sm font-medium">Who</label>
                          <select
                            id={id("custom-who")}
                            className={selectClass}
                            value={customWhoOk ? custom.who : ""}
                            disabled={pending}
                            onChange={(event) => setCustom((current) => ({ ...current, who: event.target.value }))}
                          >
                            <option value="" disabled>Choose who</option>
                            {whoOptions(true)}
                          </select>
                        </div>
                        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                          {view.roles.classes.map((item) => (
                            <label key={item.class} className="flex items-center justify-between gap-3 text-sm">
                              <span>{item.description}</span>
                              <select
                                className={`${selectBase} w-36`}
                                value={custom.access[item.class] ?? "never"}
                                disabled={pending}
                                onChange={(event) =>
                                  setCustom((current) => ({ ...current, access: { ...current.access, [item.class]: event.target.value as Access } }))
                                }
                              >
                                <option value="never">Never</option>
                                <option value="allow">Allowed</option>
                                <option value="ask">Ask me first</option>
                              </select>
                            </label>
                          ))}
                        </div>
                        {custom.access.pr_ops && custom.access.pr_ops !== "never" ? (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={custom.commentsOnly}
                              disabled={pending}
                              onChange={(event) => setCustom((current) => ({ ...current, commentsOnly: event.target.checked }))}
                            />
                            Pull request work: comments only
                          </label>
                        ) : null}
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={id("targets")} className="text-sm font-medium">Repos</label>
                          <div className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 ${targetProblem ? "border-destructive" : "border-input"}`}>
                            {targetChips.map((target, index) => (
                              <span
                                key={`${target}-${index}`}
                                data-testid="target-chip"
                                className="inline-flex items-center gap-1 rounded bg-[var(--surface-soft)] px-2 py-0.5 font-mono text-xs"
                              >
                                {target}
                                <button
                                  type="button"
                                  aria-label={`Remove ${target}`}
                                  disabled={pending}
                                  className="border-0 bg-transparent p-0 leading-none text-muted-foreground shadow-none hover:text-foreground"
                                  onClick={() => setTargetChips((chips) => chips.filter((_, at) => at !== index))}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <input
                              id={id("targets")}
                              value={targetDraft}
                              disabled={pending}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={targetChips.length ? "" : `${EVERYTHING} (or owner/repo, owner/* for all of an owner's repos)`}
                              aria-invalid={targetProblem ? true : undefined}
                              className="h-7 min-w-32 flex-1 border-0 bg-transparent p-0 text-sm shadow-none outline-none placeholder:text-muted-foreground"
                              onChange={(event) => typeTargets(event.target.value)}
                              onKeyDown={targetKey}
                            />
                          </div>
                          {targetProblem ? <p role="alert" className="text-xs text-destructive">{targetProblem}</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-4">{expiryControl(customExpiry, setCustomExpiry, "custom-expiry")}{bulkEligible(custom.who) ? allWorkspacesControl(customAllWorkspaces, setCustomAllWorkspaces) : null}</div>
                          <div className="flex items-center gap-2">
                            {message("custom")}
                            <Button type="submit" size="sm" disabled={pending || !customValid}>Add custom permission</Button>
                          </div>
                        </div>
                      </form>
                    </section>
                  ) : null}

                  <section className="flex flex-col gap-3" aria-labelledby={id("groups-heading")}>
                    <h4 id={id("groups-heading")} className="text-sm font-semibold">Groups</h4>
                    <ul className="flex flex-col gap-2 text-sm">
                      {[...(relayGroup ? [relayGroup] : []), ...connectorGroups, ...customGroups].map((group) => (
                        <li key={group.group_id} className="flex flex-col gap-1 rounded-lg border border-[var(--border-default)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{group.name}</span>
                            {group.kind === "custom" ? (
                              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm({ kind: "group", group })}>
                                Delete
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">New connected agents join automatically</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.members === null ? (
                              <span className="text-xs text-muted-foreground">Everyone it covers; see Your agents below.</span>
                            ) : null}
                            {(group.members ?? []).map((member) => (
                              <span
                                key={member.agent_id}
                                className="inline-flex items-center gap-1 rounded bg-[var(--surface-soft)] px-2 py-0.5 text-xs"
                                title={member.proven === false ? "No longer proven yours: it gets nothing from this group" : undefined}
                              >
                                {`${member.name ?? member.agent_id}${member.proven === false ? " (not proven)" : ""}`}
                                {group.kind === "custom" ? (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${member.name ?? member.agent_id} from ${group.name}`}
                                    disabled={pending}
                                    className="border-0 bg-transparent p-0 leading-none text-muted-foreground shadow-none hover:text-foreground"
                                    onClick={() =>
                                      void run("groups", async () => {
                                        await adminApi.updateDelegationGroup(workspaceId, group.group_id, { remove: [member.agent_id] });
                                        return `Removed ${member.name ?? member.agent_id} from ${group.name}.`;
                                      })
                                    }
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </span>
                            ))}
                            {group.members?.length === 0 ? <span className="text-xs text-muted-foreground">No agents yet</span> : null}
                          </div>
                          {group.kind === "custom" && delegationEnabled
                            && view.agents.some((agent) => !group.members?.some((member) => member.agent_id === agent.agent_id)) ? (
                            <div className="flex items-center gap-2">
                              <select
                                className={`${selectBase} w-56`}
                                aria-label={`Add an agent to ${group.name}`}
                                value={groupPick[group.group_id] ?? ""}
                                disabled={pending}
                                onChange={(event) => {
                                  const agentId = event.target.value;
                                  setGroupPick((picks) => ({ ...picks, [group.group_id]: agentId }));
                                }}
                              >
                                <option value="" disabled>Add an agent</option>
                                {view.agents
                                  .filter((agent) => !group.members?.some((member) => member.agent_id === agent.agent_id))
                                  .map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{`${agent.name} (${agent.agent_id})`}</option>)}
                              </select>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-label={`Add to ${group.name}`}
                                disabled={pending || !groupPick[group.group_id]}
                                onClick={() => {
                                  const agentId = groupPick[group.group_id];
                                  if (!agentId) return;
                                  const name = view.agents.find((agent) => agent.agent_id === agentId)?.name ?? agentId;
                                  void run("groups", async () => {
                                    await adminApi.updateDelegationGroup(workspaceId, group.group_id, { add: [agentId] });
                                    setGroupPick((picks) => ({ ...picks, [group.group_id]: "" }));
                                    return `Added ${name} to ${group.name}.`;
                                  });
                                }}
                              >
                                Add
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {delegationEnabled ? (
                      <form
                        className="flex flex-col gap-2"
                        aria-label="Create a group"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          const name = newGroup.name.trim();
                          if (!name) return;
                          void run("groups", async () => {
                            await adminApi.createDelegationGroup(workspaceId, { name, agent_ids: newGroup.agents });
                            return `Created ${name}.`;
                          }).then((created) => {
                            if (created) setNewGroup({ name: "", agents: [] });
                          });
                        }}
                      >
                        <Input
                          aria-label="Group name"
                          placeholder="New group name"
                          className="max-w-xs"
                          maxLength={80}
                          value={newGroup.name}
                          disabled={pending}
                          onChange={(event) => setNewGroup((current) => ({ ...current, name: event.target.value }))}
                        />
                        <div className="flex flex-wrap gap-3 text-sm">
                          {view.agents.map((agent) => (
                            <label key={agent.agent_id} className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                className="size-4"
                                disabled={pending}
                                checked={newGroup.agents.includes(agent.agent_id)}
                                onChange={(event) =>
                                  setNewGroup((current) => ({
                                    ...current,
                                    agents: event.target.checked
                                      ? [...current.agents, agent.agent_id]
                                      : current.agents.filter((item) => item !== agent.agent_id),
                                  }))
                                }
                              />
                              {agent.name}
                            </label>
                          ))}
                        </div>
                        <div>
                          <Button type="submit" size="sm" variant="outline" disabled={pending || !newGroup.name.trim()}>Create group</Button>
                        </div>
                      </form>
                    ) : null}
                    {message("groups")}
                  </section>

                  <section className="flex flex-col gap-3" aria-labelledby={id("agents-heading")}>
                    <h4 id={id("agents-heading")} className="text-sm font-semibold">Your agents</h4>
                    <p className="text-sm text-muted-foreground">
                      What decides each agent now. Excluding an agent gives it no access until you give it its own setting.
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
                      <table className={tableClass} aria-label="Your agents">
                        <thead>
                          <tr>
                            <th>Agent</th>
                            <th>Role</th>
                            <th>Decided by</th>
                            <th><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {view.agents.map((agent) => {
                            const binding = view.bindings.find((item) => item.binding_id === agent.effective.binding_id);
                            const excluded = agent.effective.role === "excluded";
                            return (
                              <tr key={agent.agent_id}>
                                <td>
                                  {agent.name}
                                  <span className="block font-mono text-xs text-muted-foreground">{agent.agent_id}</span>
                                </td>
                                <td>{presetLabel(agent.effective.role)}</td>
                                <td>
                                  {SOURCE_LABELS[agent.effective.source] ?? agent.effective.source}
                                  {binding && (agent.effective.source === "group" || agent.effective.source === "connector_kind") ? (
                                    <span className="block text-xs text-muted-foreground">{binding.principal.name}</span>
                                  ) : null}
                                </td>
                                <td className="text-right">
                                  {/* Exclude works with delegation off (a POST of an exclusion is allowed then); giving a role does not. */}
                                  {excluded && binding && delegationEnabled ? (
                                    <select
                                      className={`${selectBase} w-40`}
                                      aria-label={`Give ${agent.name} a role`}
                                      value=""
                                      disabled={pending}
                                      onChange={(event) =>
                                        void patch("agents", binding, { role: event.target.value }, `${agent.name} is now ${presetLabel(event.target.value)}.`)
                                      }
                                    >
                                      <option value="" disabled>Give it a role</option>
                                      {presets.map((preset) => <option key={preset.role} value={preset.role}>{preset.label}</option>)}
                                    </select>
                                  ) : !excluded ? (
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void exclude(agent)}>
                                      Exclude
                                    </Button>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                          {view.agents.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="text-center text-muted-foreground">No agents proven yours yet.</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    {view.agentsUnavailable ? (
                      <p role="status" className="text-sm text-muted-foreground">{`Your agents can't be listed right now: ${view.agentsUnavailable}`}</p>
                    ) : null}
                    {message("agents")}
                  </section>

                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Permission rows can&apos;t be read right now. Explicit grants and Revoke everything below still work.
                    </p>
                  )}

                </div>
              ) : null}
              {/* Kept mounted while Advanced is closed: a grant change in flight still finishes, re-reads and tells the page. */}
                  <section aria-label="Explicit grants" hidden={!advancedShown}>
                    <DelegatesSection
                      workspaceId={workspaceId}
                      delegationEnabled={delegationEnabled}
                      maxExpiryDays={props.maxExpiryDays}
                      isAdmin={props.isAdmin}
                      refreshKey={props.grantsRefreshKey}
                      onGrantsChanged={props.onGrantsChanged}
                    />
                  </section>
            </div>
      </CardContent>
    </Card>
  );
}
