// Hosted Cloud's DelegatesSection
// (packages/web/app/dashboard/settings/delegates-section.tsx), on
// relay-control's existing /workspaces/{id}/delegates routes: list grants
// (GET, `all=1` for owners and admins), grant (POST), revoke one
// (DELETE /{grantId}) or all (POST /revoke-all), and start a claim
// (POST /claims).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { adminApi } from "./api";
import { DELEGATION_CLASS_DESCRIPTIONS, DELEGATION_CLASSES, type DelegationClass } from "./contracts";
import { delegationError } from "./delegation-errors";
import { useLoad } from "./use-load";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Switch } from "../shell/ui";

type Claim = { claim_id: string; code: string; expires_at: string };
type Confirm = { kind: "one"; grantId: string } | { kind: "all" };
/** Which part of the panel an action's message belongs under. */
type Area = "list" | "form" | "claim" | "danger";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";
const sectionClass = "flex flex-col gap-3 border-t border-[var(--border-default)] pt-6 first:border-t-0 first:pt-0";
const headingClass = "text-sm font-semibold text-foreground";
const fieldClass = "flex flex-col gap-1.5";
const labelClass = "text-sm font-medium";

/** Expiry presets, capped by the policy's maximum. The default sends no expiry: the server then uses min(30, max). */
const EXPIRY_PRESETS = [7, 30, 90] as const;
const SERVER_DEFAULT_DAYS = 30;
export function expiryOptions(maxExpiryDays: number): { value: string; label: string }[] {
  const fallback = Math.min(SERVER_DEFAULT_DAYS, maxExpiryDays);
  return [
    { value: "", label: `${fallback} days (default)` },
    ...EXPIRY_PRESETS.filter((days) => days <= maxExpiryDays && days !== fallback).map((days) => ({
      value: String(days),
      label: `${days} days`,
    })),
  ];
}

/** Splits typed text into finished targets and the part still being typed (whitespace separates targets). */
export function splitTargets(text: string): { done: string[]; draft: string } {
  const parts = text.split(/\s+/u);
  const draft = parts.pop() ?? "";
  return { done: parts.filter(Boolean), draft };
}

/**
 * Owner-named trusted delegates for this workspace: start a claim for an
 * external agent, grant one of your agents, list grants, and revoke one or
 * all. The routes decide who may do what: everyone manages their own grants,
 * org owners and admins may list and revoke every grant. Claims and new
 * grants need delegation on; listing and revoking work while it is off, as
 * the API allows.
 *
 * It belongs to the workspace it was rendered for (DelegationSection is keyed
 * by workspace id): an answer that settles after a switch is dropped.
 *
 * The grant list belongs to the view it was read for (mine, or every grant):
 * rows from another view are never shown, so a Revoke button always matches
 * its view, and a failed read shows its error with a retry.
 *
 * Laid out as four parts, as Cloud's: your delegates (the list), add a
 * delegate (the form), connect an external agent (the claim) and a danger
 * zone (revoke all). The agent is typed as an id: no existing read route
 * lists the caller's bindable agents by id (the roster has names only, and a
 * grant never accepts a name).
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
  /** A new value re-reads the list (the trust rule changed, which can end grants). */
  refreshKey?: number;
  /** Called after a grant was added or revoked, so what depends on the grants (the trust rule card) re-reads. */
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
  // Only rows read for the view on screen; another view's rows (and their Revoke buttons) never show.
  const grants = list && list.all === all ? list.grants : null;
  const [feedback, setFeedback] = useState<{ area: Area; text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [agentId, setAgentId] = useState("");
  const [actionClass, setActionClass] = useState<DelegationClass>(DELEGATION_CLASSES[0]);
  // Finished targets (chips) and the one being typed; whitespace separates them, as before.
  const [targetChips, setTargetChips] = useState<string[]>([]);
  const [targetDraft, setTargetDraft] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [tierO, setTierO] = useState(false);

  // A claim code is shown once; turning delegation off and on again must not bring it back.
  if (!delegationEnabled && claim) setClaim(null);

  const setError = (area: Area, text: string) => setFeedback({ area, text, error: true });
  const setNotice = (area: Area, text: string) => setFeedback({ area, text, error: false });

  /** Runs one change; `work` answers true when the grant list should be re-read. */
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

  // Targets are separated by whitespace, which no target can hold; a comma can be part of one.
  const targetList = [...targetChips, ...targetDraft.split(/\s+/u).filter(Boolean)];
  const agentProblem = /\s/u.test(agentId.trim()) ? "An agent id has no spaces. Use the id, not the name." : null;
  const targetProblem = targetList.some((target) => target.endsWith(","))
    ? "Separate targets with spaces, not commas: a comma is kept as part of the target."
    : null;
  const formValid = Boolean(agentId.trim()) && !agentProblem && targetList.length > 0 && !targetProblem;

  const addGrant = () =>
    run(async () => {
      const list = targetList;
      if (!agentId.trim() || !list.length) {
        setError("form", "Enter the agent id and at least one target.");
        return;
      }
      if (agentProblem || targetProblem) {
        setError("form", (agentProblem ?? targetProblem)!);
        return;
      }
      const days = expiryDays.trim() ? Number(expiryDays) : null;
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > maxExpiryDays)) {
        setError("form", `Expiry must be a whole number of days from 1 to ${maxExpiryDays}.`);
        return;
      }
      const granted = await adminApi.createDelegateGrant(workspaceId, {
        delegate_agent_id: agentId.trim(),
        scopes: [{ class: actionClass, targets: list }],
        ...(days !== null ? { expires_at: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
        ...(tierO ? { require_tier_o: [actionClass] } : {}),
      });
      if (!mounted.current) return;
      setAgentId("");
      setTargetChips([]);
      setTargetDraft("");
      setExpiryDays("");
      setTierO(false);
      setNotice("form", `Granted ${granted.delegate_agent_id}.`);
      return true;
    }, "Could not grant the delegate. Try again.", "form");

  const revoke = () => {
    const what = confirm;
    setConfirm(null);
    if (!what) return;
    return run(async () => {
      if (what.kind === "one") {
        await adminApi.revokeDelegateGrant(workspaceId, what.grantId);
        if (mounted.current) setNotice("list", "Grant revoked.");
      } else {
        const revoked = await adminApi.revokeAllDelegateGrants(workspaceId, all);
        if (mounted.current) setNotice("danger", `Revoked ${revoked.length} grant(s) and the approvals in scope.`);
      }
      return true;
    }, "Could not revoke. Try again.", what.kind === "one" ? "list" : "danger");
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("claim", "Code copied.");
    } catch {
      setNotice("claim", "Copy failed; select the code and copy it by hand.");
    }
  };

  /** Typing a space (or pasting several targets) turns each finished target into a chip. */
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
  const message = (area: Area) =>
    feedback?.area === area ? (
      feedback.error ? (
        <p role="alert" className="text-sm text-destructive">{feedback.text}</p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{feedback.text}</p>
      )
    ) : null;
  const confirmButtons = (
    <div className="flex gap-2">
      <Button
        type="button"
        variant={confirm?.kind === "all" ? "destructive" : "default"}
        disabled={pending}
        onClick={() => void revoke()}
      >
        Revoke
      </Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delegates</CardTitle>
        <CardDescription>
          A delegate is one of your agents that can pass on your approval to other people&apos;s agents, only for the
          actions and repositories you choose.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className={sectionClass} aria-labelledby={id("list-heading")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 id={id("list-heading")} className={headingClass}>Your delegates</h4>
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
            ) : null}
          </div>
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {delegationError(loadError, "Could not load grants.")}{" "}
              <Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button>
            </p>
          ) : null}
          {grants === null ? (
            loadError ? null : <p className="text-sm text-muted-foreground">Loading grants...</p>
          ) : grants.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-sm">
              <p className="font-medium">{all ? "No grants in this workspace yet." : "No delegates yet."}</p>
              <p className="text-muted-foreground">
                {all
                  ? "When anyone here adds a delegate, it shows up in this list."
                  : "Add a delegate below to let one of your agents pass on your approval."}
              </p>
            </div>
          ) : (
            <ul
              className="flex flex-col divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)]"
              aria-label="Delegate grants"
            >
              {grants.map((grant) => (
                <li key={grant.grant_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono">{grant.delegate_agent_id}</code>
                      <Badge variant={grant.status === "active" ? "success" : "default"}>{grant.status}</Badge>
                    </div>
                    <span>
                      {grant.trust_rule_id
                        ? "All classes (trust rule)"
                        : grant.scopes.map((scope) => `${scope.class}: ${scope.targets.join(" ")}`).join("; ")}
                    </span>
                    <span className="text-muted-foreground">
                      {[
                        grant.require_tier_o.length
                          ? `Asks its owner before each action in: ${grant.require_tier_o.join(", ")}`
                          : null,
                        `Expires ${new Date(grant.expires_at).toLocaleDateString()}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {grant.status === "active" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      aria-label={`Revoke ${grant.delegate_agent_id}`}
                      onClick={() => setConfirm({ kind: "one", grantId: grant.grant_id })}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {confirm?.kind === "one" ? (
            <div
              className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] p-3"
              role="group"
              aria-label="Confirm revocation"
            >
              <p className="text-sm">Revoke this grant? Its unredeemed approvals stop working at once.</p>
              {confirmButtons}
            </div>
          ) : null}
          {message("list")}
        </section>

        <section className={sectionClass} aria-labelledby={id("form-heading")}>
          <h4 id={id("form-heading")} className={headingClass}>Add a delegate</h4>
          {delegationEnabled ? (
            <form
              className="grid gap-4 sm:grid-cols-2"
              aria-label="Grant a delegate"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (formValid) void addGrant();
              }}
            >
              <div className={fieldClass}>
                <label htmlFor={id("agent")} className={labelClass}>Agent id</label>
                <Input
                  id={id("agent")}
                  value={agentId}
                  placeholder="agt_..."
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={agentProblem ? true : undefined}
                  aria-describedby={id("agent-hint")}
                  onChange={(event) => setAgentId(event.target.value)}
                  disabled={pending}
                />
                <p id={id("agent-hint")} role={agentProblem ? "alert" : undefined} className={`text-xs ${agentProblem ? "text-destructive" : "text-muted-foreground"}`}>
                  {agentProblem ?? "The agent's id, not its name. It must be yours: connect an external agent below first."}
                </p>
              </div>
              <div className={fieldClass}>
                <label htmlFor={id("expiry")} className={labelClass}>Expires after</label>
                <select
                  id={id("expiry")}
                  className={selectClass}
                  value={expiryDays}
                  onChange={(event) => setExpiryDays(event.target.value)}
                  disabled={pending}
                >
                  {expiryOptions(maxExpiryDays).map((option) => (
                    <option key={option.value || "default"} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{`This workspace allows up to ${maxExpiryDays} days.`}</p>
              </div>
              <div className={`${fieldClass} sm:col-span-2`}>
                <label htmlFor={id("class")} className={labelClass}>Class</label>
                <select
                  id={id("class")}
                  className={selectClass}
                  value={actionClass}
                  onChange={(event) => setActionClass(event.target.value as DelegationClass)}
                  disabled={pending}
                >
                  {DELEGATION_CLASSES.map((item) => (
                    <option key={item} value={item} title={DELEGATION_CLASS_DESCRIPTIONS[item]}>
                      {`${item} — ${DELEGATION_CLASS_DESCRIPTIONS[item]}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${fieldClass} sm:col-span-2`}>
                <label htmlFor={id("targets")} className={labelClass}>Targets</label>
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
                    placeholder={targetChips.length ? "" : "acme/web acme/*"}
                    aria-invalid={targetProblem ? true : undefined}
                    aria-describedby={id("targets-hint")}
                    className="h-7 min-w-32 flex-1 border-0 bg-transparent p-0 text-sm shadow-none outline-none placeholder:text-muted-foreground"
                    onChange={(event) => typeTargets(event.target.value)}
                    onKeyDown={targetKey}
                  />
                </div>
                <p id={id("targets-hint")} role={targetProblem ? "alert" : undefined} className={`text-xs ${targetProblem ? "text-destructive" : "text-muted-foreground"}`}>
                  {targetProblem ??
                    "Press space or Enter after each target. owner/repo is one repository; owner/* means every repository that owner has."}
                </p>
              </div>
              <div className={`${fieldClass} sm:col-span-2`}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={tierO}
                    onChange={(event) => setTierO(event.target.checked)}
                    disabled={pending}
                  />
                  Ask me before each action in this class
                </label>
                <p className="text-xs text-muted-foreground">The delegate then can&apos;t approve these alone; you approve each one.</p>
              </div>
              <div className="flex items-center justify-end gap-3 sm:col-span-2">
                {message("form")}
                <Button type="submit" disabled={pending || !formValid}>Grant</Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Delegation is off for this workspace, so no claim or new grant can be made. Existing grants can still be
              listed and revoked.
            </p>
          )}
        </section>

        {delegationEnabled ? (
          <section className={sectionClass} aria-labelledby={id("claim-heading")}>
            <h4 id={id("claim-heading")} className={headingClass}>Connect an external agent</h4>
            <p className="text-sm text-muted-foreground">
              Make an agent on another provider (for example a chat assistant) yours: start a claim, give it the one-time
              code, and it completes the claim with its own agent token. Then add it as a delegate above.
            </p>
            {claim ? (
              <div
                className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] p-3"
                role="group"
                aria-label="One-time code"
              >
                <p className="text-sm font-medium">Give this code to the agent</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code data-testid="claim-code" className="rounded bg-[var(--surface-soft)] px-2 py-1 font-mono text-sm">
                    {claim.code}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copy(claim.code)}>
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Valid until {new Date(claim.expires_at).toLocaleString()}; it works once.
                </p>
              </div>
            ) : (
              <div>
                <Button type="button" variant="outline" disabled={pending} onClick={() => void startClaim()}>
                  Start a claim
                </Button>
              </div>
            )}
            {message("claim")}
          </section>
        ) : null}

        <section
          className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
          aria-labelledby={id("danger-heading")}
        >
          <h4 id={id("danger-heading")} className="text-sm font-semibold text-destructive">Danger zone</h4>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {all
                ? "Revoke every grant, trust rule and unredeemed approval in this workspace at once."
                : "Revoke all your grants, your trust rule and every unredeemed approval you gave, at once."}
            </p>
            {/* Always offered: it also revokes approvals given without a grant, which the list does not show. */}
            <Button type="button" variant="destructive" disabled={pending} onClick={() => setConfirm({ kind: "all" })}>
              {all ? "Revoke every grant and approval" : "Revoke all my grants and approvals"}
            </Button>
          </div>
          {confirm?.kind === "all" ? (
            <div className="flex flex-col gap-2" role="group" aria-label="Confirm revocation">
              <p className="text-sm">
                {all
                  ? "Revoke every grant and approval in this workspace? Every grant and every trust rule is revoked, and every unredeemed " +
                    "approval from anyone stops working at once, including approvals given without a grant."
                  : "Revoke all your grants and approvals? Every grant you made and your trust rule are revoked, and every unredeemed " +
                    "approval you gave stops working at once, including approvals given without a grant."}
              </p>
              {confirmButtons}
            </div>
          ) : null}
          {message("danger")}
        </section>
      </CardContent>
    </Card>
  );
}
