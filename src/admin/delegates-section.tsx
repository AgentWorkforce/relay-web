// Hosted Cloud's DelegatesSection (explicit grants)
// (packages/web/app/dashboard/settings/delegates-section.tsx), on
// relay-control's existing /workspaces/{id}/delegates routes: list grants
// (GET, `all=1` for owners and admins), grant (POST), revoke one
// (DELETE /{grantId}) or all (POST /revoke-all), and start a claim
// (POST /claims).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { adminApi } from "./api";
import { DELEGATION_CLASSES, type DelegateGrant, type DelegationClass } from "./contracts";
import { delegationError } from "./delegation-errors";
import { useLoad } from "./use-load";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Switch } from "../shell/ui";

type Claim = { claim_id: string; code: string; expires_at: string };
type Confirm = { kind: "one"; grantId: string; ruled: boolean } | { kind: "all" };
/** Where an action's message is shown. */
type Area = "table" | "add" | "claim";

/** A native select styled like the inputs; add a width (selectClass is full width). */
export const selectBase =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";
export const selectClass = `${selectBase} w-full`;
export const tableClass = "w-full text-sm [&_th]:h-10 [&_th]:px-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium "
  + "[&_th]:uppercase [&_th]:tracking-[0.2em] [&_th]:text-[var(--text-muted)] [&_td]:px-3 [&_td]:py-3 [&_tr]:border-b "
  + "[&_tr]:border-[var(--border-default)] [&_tbody_tr:last-child]:border-0";

/**
 * The "Can" choices: each class, and the same class with "ask me first", which sends the class in
 * `require_tier_o` (the owner approves each such action; the delegate cannot approve it alone).
 */
const ASK_FIRST = ":ask";
export const CAN_OPTIONS: { value: string; label: string }[] = DELEGATION_CLASSES.flatMap((item) => [
  { value: item, label: item },
  { value: `${item}${ASK_FIRST}`, label: `${item} (ask me first)` },
]);
function parseCan(value: string): { actionClass: DelegationClass; askFirst: boolean } {
  const askFirst = value.endsWith(ASK_FIRST);
  return { actionClass: (askFirst ? value.slice(0, -ASK_FIRST.length) : value) as DelegationClass, askFirst };
}

/** Expiry presets, capped by the policy's maximum. No preset chosen sends no expiry: the server then uses min(30, max). */
const EXPIRY_PRESETS = [7, 30, 90] as const;
const CONDITION_NAMES: Record<string, string> = { ci_green: "checks pass", mergeable: "mergeable" };
export function expiryOptions(maxExpiryDays: number): number[] {
  const presets = EXPIRY_PRESETS.filter((days) => days <= maxExpiryDays);
  return presets.length ? [...presets] : [maxExpiryDays];
}

/** Splits typed text into finished resources and the part still being typed (whitespace separates them). */
export function splitTargets(text: string): { done: string[]; draft: string } {
  const parts = text.split(/\s+/u);
  const draft = parts.pop() ?? "";
  return { done: parts.filter(Boolean), draft };
}

/**
 * Explicit grants: one agent, specific actions on specific resources, as a table (agent, can, on,
 * expires, remove). The routes decide who may do what: everyone manages their own grants, org owners
 * and admins may list and revoke every grant. New grants and claims need delegation on; listing and
 * removing work while it is off, as the API allows.
 *
 * It belongs to the workspace it was rendered for (DelegationSection is keyed by workspace id): an
 * answer that settles after a switch is dropped. The table belongs to the view it was read for (mine,
 * or every grant): rows from another view are never shown, and a failed read shows its error with a
 * retry. The agent is typed as an id: grants take the immutable id, never a name.
 */
export function DelegatesSection({
  workspaceId,
  delegationEnabled,
  maxExpiryDays,
  isAdmin,
  refreshKey = 0,
  onGrantsChanged,
}: {
  workspaceId: string;
  delegationEnabled: boolean;
  maxExpiryDays: number;
  isAdmin: boolean;
  /** A new value re-reads the list (a binding or the trust rule changed, which can end grants). */
  refreshKey?: number;
  /** Called after a grant was added or revoked, so what depends on the grants re-reads. */
  onGrantsChanged?: () => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [all, setAll] = useState(false);
  const { data: list, error: loadError, reload } = useLoad(async (signal) => ({
    all,
    grants: await adminApi.delegateGrants(workspaceId, all, signal),
  }));
  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (seenRefresh !== refreshKey) {
    setSeenRefresh(refreshKey);
    reload();
  }
  // Only rows read for the view on screen; another view's rows (and their Remove buttons) never show.
  const grants = list && list.all === all ? list.grants : null;
  const [feedback, setFeedback] = useState<{ area: Area; text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [can, setCan] = useState<string>(DELEGATION_CLASSES[0]);
  // Finished resources (chips) and the one being typed; whitespace separates them.
  const [targetChips, setTargetChips] = useState<string[]>([]);
  const [targetDraft, setTargetDraft] = useState("");
  // Null: no expiry chosen, so none is sent and the server's default applies.
  const [expiryDays, setExpiryDays] = useState<string | null>(null);

  // A claim code is shown once; turning delegation off and on again must not bring it back.
  if (!delegationEnabled && claim) setClaim(null);

  // The shown code is marked expired once its expires_at passes (the server refuses it then), so the
  // claim step says so and offers a new claim instead of a code that no longer works.
  const [expiredClaimId, setExpiredClaimId] = useState<string | null>(null);
  useEffect(() => {
    if (!claim) return;
    const left = Date.parse(claim.expires_at) - Date.now();
    const timer = setTimeout(() => setExpiredClaimId(claim.claim_id), Number.isFinite(left) ? Math.max(0, left) : 0);
    return () => clearTimeout(timer);
  }, [claim]);
  const claimExpired = claim !== null && expiredClaimId === claim.claim_id;

  const setError = (area: Area, text: string) => setFeedback({ area, text, error: true });
  const setNotice = (area: Area, text: string) => setFeedback({ area, text, error: false });

  /** Runs one change; `work` answers true when the list should be re-read. */
  const run = async (work: () => Promise<boolean | void>, fallback: string, area: Area) => {
    setPending(true);
    setFeedback(null);
    try {
      if ((await work()) && mounted.current) {
        reload();
        onGrantsChanged?.();
      }
    } catch (failure) {
      if (mounted.current) setError(area, delegationError(failure, fallback));
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const startClaim = () =>
    run(async () => {
      const started = await adminApi.startDelegateClaim(workspaceId);
      if (mounted.current) setClaim(started);
    }, "Could not start a claim. Try again.", "claim");

  // Resources are separated by whitespace, which none can hold; a comma can be part of one.
  const targetList = [...targetChips, ...targetDraft.split(/\s+/u).filter(Boolean)];
  const agentProblem = /\s/u.test(agentId.trim()) ? "An agent id has no spaces." : null;
  const targetProblem = targetList.some((target) => target.endsWith(","))
    ? "Separate resources with spaces, not commas: a comma is kept as part of the resource."
    : null;
  const formValid = Boolean(agentId.trim()) && !agentProblem && targetList.length > 0 && !targetProblem;

  const resetForm = () => {
    setAgentId("");
    setCan(DELEGATION_CLASSES[0]);
    setTargetChips([]);
    setTargetDraft("");
    setExpiryDays(null);
  };

  const addGrant = () =>
    run(async () => {
      const targets = targetList;
      if (!agentId.trim() || !targets.length) {
        setError("add", "Enter the agent id and at least one resource.");
        return;
      }
      if (agentProblem || targetProblem) {
        setError("add", (agentProblem ?? targetProblem)!);
        return;
      }
      const days = expiryDays ? Number(expiryDays) : null;
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > maxExpiryDays)) {
        setError("add", `Expiry must be a whole number of days from 1 to ${maxExpiryDays}.`);
        return;
      }
      const { actionClass, askFirst } = parseCan(can);
      const granted = await adminApi.createDelegateGrant(workspaceId, {
        delegate_agent_id: agentId.trim(),
        scopes: [{ class: actionClass, targets }],
        ...(days !== null ? { expires_at: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
        ...(askFirst ? { require_tier_o: [actionClass] } : {}),
      });
      if (!mounted.current) return;
      resetForm();
      setAdding(false);
      setNotice("table", `Added ${granted.delegate_agent_id}.`);
      return true;
    }, "Could not add the grant. Try again.", "add");

  const revoke = () => {
    const what = confirm;
    setConfirm(null);
    if (!what) return;
    return run(async () => {
      if (what.kind === "one") {
        await adminApi.revokeDelegateGrant(workspaceId, what.grantId);
        if (mounted.current) setNotice("table", "Removed.");
      } else {
        const revoked = await adminApi.revokeAllDelegateGrants(workspaceId, all);
        if (mounted.current) setNotice("table", `Revoked ${revoked.length} grant(s) and the approvals in scope.`);
      }
      return true;
    }, "Could not revoke. Try again.", "table");
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("claim", "Code copied.");
    } catch {
      setNotice("claim", "Copy failed; select the code and copy it by hand.");
    }
  };

  /** Typing a space (or pasting several) turns each finished resource into a chip. */
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

  const id = (name: string) => `delegates-${name}-${workspaceId}`;
  // With no expiry chosen none is sent, and the server sets min(30, the policy's maximum) days.
  const defaultDays = Math.min(30, maxExpiryDays);
  const message = (area: Area) =>
    feedback?.area === area ? (
      feedback.error ? (
        <p role="alert" className="text-sm text-destructive">{feedback.text}</p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{feedback.text}</p>
      )
    ) : null;
  // A system grant (from a permission row) carries its binding's scopes; one with no scopes is a rule from before roles.
  const legacy = (grant: DelegateGrant) => Boolean(grant.trust_rule_id) && grant.scopes.length === 0;
  const scopeText = (grant: DelegateGrant, scope: DelegateGrant["scopes"][number]) =>
    [
      scope.class,
      scope.ops?.length ? ` (only: ${scope.ops.join(", ")})` : "",
      scope.conditions?.length
        ? ` (when ${scope.conditions.map((condition) => CONDITION_NAMES[condition.type] ?? condition.type).join(" and ")})`
        : "",
      grant.require_tier_o.includes(scope.class) ? ", ask me first" : "",
    ].join("");
  /** One line per scope, so each action stays beside its own repos (the On column lines up with these). */
  const canLines = (grant: DelegateGrant): string[] =>
    legacy(grant)
      ? [`All actions (set before roles)${grant.require_tier_o.length ? `; ask me first: ${grant.require_tier_o.join(", ")}` : ""}`]
      : grant.scopes.map((scope) => scopeText(grant, scope));
  const onLines = (grant: DelegateGrant): string[] =>
    legacy(grant) ? ["Everything I own"] : grant.scopes.map((scope) => (scope.targets.length ? scope.targets.join(" ") : "Everything I own"));
  const openAdd = () => {
    setAdding(true);
    setFeedback(null);
  };
  const confirmButtons = (
    <div className="flex gap-2">
      <Button
        type="button"
        size="sm"
        variant={confirm?.kind === "all" ? "destructive" : "default"}
        disabled={pending}
        onClick={() => void revoke()}
      >
        {confirm?.kind === "all" ? "Revoke everything" : "Remove"}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Explicit grants</CardTitle>
        <CardDescription>One agent, specific actions on specific repos. These win over every other setting.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Switch
                id={id("all")}
                checked={all}
                disabled={pending}
                onCheckedChange={(checked) => {
                  setAll(checked);
                  setConfirm(null);
                  reload();
                }}
              />
              <label htmlFor={id("all")} className="text-sm">Show every grant in the workspace</label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {delegationEnabled && !adding ? (
              <Button type="button" size="sm" disabled={pending} onClick={openAdd}>Add grant</Button>
            ) : null}
            <div className="relative">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </Button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-10 mt-1 min-w-44 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-1 shadow-md"
                >
                  {/* Always offered: it also revokes approvals given without a grant, which the table does not show. */}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    className="w-full rounded border-0 bg-transparent px-2 py-1.5 text-left text-sm text-destructive shadow-none hover:bg-[var(--surface-soft)]"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirm({ kind: "all" });
                    }}
                  >
                    Revoke everything
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {confirm?.kind === "all" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3" role="group" aria-label="Confirm revocation">
            <p className="text-sm">
              {all
                ? "Revoke everything in this workspace? Every grant and every permission row (Relay agents, connector and group " +
                  "rows, single agents and exclusions, and the old trust rules) is removed, and every unredeemed approval from anyone " +
                  "stops working at once, including approvals given without a grant. Groups themselves are kept."
                : "Revoke everything of yours? Every grant you made and every permission row of yours (Relay agents, connector and " +
                  "group rows, single agents and exclusions, and your old trust rule) is removed, and every unredeemed approval you " +
                  "gave stops working at once, including approvals given without a grant. Your groups themselves are kept."}
            </p>
            {confirmButtons}
          </div>
        ) : null}

        {adding && delegationEnabled ? (
          <form
            className="grid gap-3 rounded-lg border border-[var(--border-default)] p-3 sm:grid-cols-[1fr_1fr_1.4fr]"
            aria-label="Add grant"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (formValid) void addGrant();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id("agent")} className="text-sm font-medium">Agent</label>
              <Input
                id={id("agent")}
                value={agentId}
                placeholder="agent id"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={agentProblem ? true : undefined}
                onChange={(event) => setAgentId(event.target.value)}
                disabled={pending}
              />
              <p role={agentProblem ? "alert" : undefined} className={`text-xs ${agentProblem ? "text-destructive" : "text-muted-foreground"}`}>
                {agentProblem ?? "Its id, not its name."}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id("can")} className="text-sm font-medium">Can</label>
              <select id={id("can")} className={selectClass} value={can} disabled={pending} onChange={(event) => setCan(event.target.value)}>
                {CAN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id("targets")} className="text-sm font-medium">On</label>
              <div
                className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 ${
                  targetProblem ? "border-destructive" : "border-input"
                }`}
              >
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
                  placeholder={targetChips.length ? "" : "owner/repo or owner/* (all repos)"}
                  aria-invalid={targetProblem ? true : undefined}
                  className="h-7 min-w-32 flex-1 border-0 bg-transparent p-0 text-sm shadow-none outline-none placeholder:text-muted-foreground"
                  onChange={(event) => typeTargets(event.target.value)}
                  onKeyDown={targetKey}
                />
              </div>
              {targetProblem ? <p role="alert" className="text-xs text-destructive">{targetProblem}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
              {expiryDays === null ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  disabled={pending}
                  onClick={() => setExpiryDays(String(expiryOptions(maxExpiryDays).at(-1)))}
                >
                  {`Expires in ${defaultDays} days. Set expiry`}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <label htmlFor={id("expiry")} className="text-sm">Expires after</label>
                  <select
                    id={id("expiry")}
                    className={`${selectBase} w-32`}
                    value={expiryDays}
                    disabled={pending}
                    onChange={(event) => setExpiryDays(event.target.value)}
                  >
                    {expiryOptions(maxExpiryDays).map((days) => (
                      <option key={days} value={String(days)}>{`${days} days`}</option>
                    ))}
                  </select>
                  <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={pending} onClick={() => setExpiryDays(null)}>
                    {`Use default (${defaultDays} days)`}
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-2">
                {message("add")}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    resetForm();
                    setAdding(false);
                    setFeedback(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending || !formValid}>Add grant</Button>
              </div>
            </div>
          </form>
        ) : null}

        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {delegationError(loadError, "Could not load grants.")}{" "}
            <Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button>
          </p>
        ) : null}
        {grants === null ? (
          loadError ? null : <p className="text-sm text-muted-foreground">Loading...</p>
        ) : grants.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-[var(--border-default)] p-4">
            <p className="text-sm text-muted-foreground">
              {all ? "No one in this workspace has given an agent permission yet." : "No explicit grants."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
            <table className={tableClass} aria-label="Explicit grants">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Can</th>
                  <th>On</th>
                  <th>Expires</th>
                  <th><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => {
                  // One table row per scope, so each action stays beside its own repos even when they wrap;
                  // the agent, expiry and Remove span the grant's rows.
                  const can = canLines(grant);
                  const on = onLines(grant);
                  const span = can.length;
                  return can.map((line, index) => (
                    <tr key={`${grant.grant_id}-${index}`} className={grant.status === "active" ? undefined : "text-muted-foreground"}>
                      {index === 0 ? <td rowSpan={span}><code className="font-mono">{grant.delegate_agent_id}</code></td> : null}
                      <td>{line}</td>
                      <td className="font-mono text-xs">{on[index]}</td>
                      {index === 0 ? (
                        <td rowSpan={span}>{grant.status === "active" ? new Date(grant.expires_at).toLocaleDateString() : grant.status}</td>
                      ) : null}
                      {index === 0 ? (
                        <td rowSpan={span} className="text-right">
                          {grant.status === "active" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              aria-label={`Remove ${grant.delegate_agent_id}`}
                              onClick={() => setConfirm({ kind: "one", grantId: grant.grant_id, ruled: Boolean(grant.trust_rule_id) })}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
        {confirm?.kind === "one" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] p-3" role="group" aria-label="Confirm revocation">
            <p className="text-sm">
              {confirm.ruled
                ? "Revoke this agent's grant from a permission row? Its unredeemed approvals stop working at once, and the agent " +
                  "is excluded: it gets nothing until " +
                  (all ? "its owner gives it its own setting." : "you give it its own setting.")
                : "Revoke this grant? Its unredeemed approvals stop working at once."}
            </p>
            {confirmButtons}
          </div>
        ) : null}
        {message("table")}
        {!delegationEnabled ? (
          <p className="text-sm text-muted-foreground">Delegation is off, so no grant can be added. You can still remove them.</p>
        ) : null}

        {delegationEnabled ? (
          claimOpen ? (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] p-3" role="group" aria-label="Connect an external agent">
              <p className="text-sm text-muted-foreground">Give an agent on another service a one-time code; it uses the code to become yours.</p>
              {claim && !claimExpired ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <code data-testid="claim-code" className="rounded bg-[var(--surface-soft)] px-2 py-1 font-mono text-sm">{claim.code}</code>
                    <Button type="button" variant="outline" size="sm" onClick={() => void copy(claim.code)}>Copy</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Valid until {new Date(claim.expires_at).toLocaleString()}; it works once.</p>
                </>
              ) : claim ? (
                <p className="text-sm">This code has expired.</p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={claim && !claimExpired ? "outline" : "default"}
                  disabled={pending}
                  onClick={() => void startClaim()}
                >
                  {claim ? "Start a new claim" : "Get a code"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setClaimOpen(false);
                    setClaim(null);
                  }}
                >
                  Close
                </Button>
              </div>
              {message("claim")}
            </div>
          ) : (
            <div>
              <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setClaimOpen(true)}>
                Connect an external agent
              </Button>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
