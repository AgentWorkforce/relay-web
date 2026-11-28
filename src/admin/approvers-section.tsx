// Hosted Cloud's ApproversSection (granted approvers)
// (packages/web/app/dashboard/settings/approvers-section.tsx), on
// relay-control's existing /workspaces/{id}/delegates routes: list approver
// grants (GET, `all=1` for owners and admins; rows with kind `approver`),
// grant one (POST with kind `approver`), revoke one (DELETE /{grantId}), and
// pick the agent from GET delegates/approver-candidates.
//
// relay-control reads no CODEOWNERS, so it refuses every approver grant with
// 403 `not_code_owner`; the form shows that refusal through delegationError
// like any other. It has no approver-candidates route either: that read
// answers 404, and the form says approver grants aren't available on this
// install instead of offering agents; the list and Remove still work. Cloud
// also hides the section behind a PostHog workspace flag (#owner-decisions
// 252314445629317120); relay-web has no PostHog, so it always renders it.
import { useEffect, useRef, useState } from "react";
import { adminApi, ApiError } from "./api";
import type { ApproverCandidate, DelegateGrant } from "./contracts";
import { delegationError } from "./delegation-errors";
import { selectBase, selectClass, tableClass } from "./delegates-section";
import { useLoad } from "./use-load";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "../shell/ui";

/** Where an action's message is shown. */
type Area = "table" | "add";

/**
 * What an approver may approve in a repository, as release grant patterns. Approvers are release-only
 * (the server refuses any other class): a land is a release target, and Releases covers every channel
 * release (with or without a profile) and iOS builds. A `*` stands for one segment between `/`, so
 * Lands names branches of one, two and three segments (`main`, `fix/x`, `feature/x/y`); a deeper
 * branch is not covered, and the label says so.
 */
export const APPROVER_KINDS = [
  { value: "land", label: "Lands (branches up to three segments, like feature/x/y)",
    patterns: (repo: string) => [`${repo}:land:*:*`, `${repo}:land:*/*:*`, `${repo}:land:*/*/*:*`] },
  { value: "release", label: "Releases", patterns: (repo: string) => [`${repo}:*:*:*:*`, `${repo}:*:*:*:*:*`] },
] as const;
/** An approver grant lasts at most this many days, whatever the policy allows. */
export const APPROVER_MAX_DAYS = 90;
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/u;

export function approverExpiryOptions(maxExpiryDays: number): number[] {
  const cap = Math.max(1, Math.floor(Math.min(APPROVER_MAX_DAYS, maxExpiryDays)));
  const presets = [7, 30, 90].filter((days) => days <= cap);
  return presets.length ? presets : [cap];
}

/**
 * Logins separated by spaces or commas, lowercased and without repeats, as the server stores them; null when one
 * is not a GitHub login or there are more than 10.
 */
export function parseLogins(text: string): string[] | null {
  const logins = [...new Set(text.split(/[\s,]+/u).filter(Boolean).map((login) => login.toLowerCase()))];
  return logins.length <= 10 && logins.every((login) => GITHUB_LOGIN.test(login)) ? logins : null;
}

/** The release scope a form choice grants: one release scope with every chosen repository's patterns. */
export function approverScopes(repos: readonly string[], kinds: readonly string[]): Array<{ class: "release"; targets: string[] }> {
  const targets = repos.flatMap((repo) =>
    APPROVER_KINDS.filter((kind) => kinds.includes(kind.value)).flatMap((kind) => kind.patterns(repo)));
  return targets.length ? [{ class: "release", targets }] : [];
}

export function isApprover(grant: DelegateGrant): boolean {
  return grant.kind === "approver";
}

/**
 * Granted approvers: one of your agents, pinned to the exact Relay address it is bound at, that may
 * approve releases and lands of a connected repository with an approver allow-list, as long as the
 * change it ships passes that allow-list. The form offers only the repositories GET
 * approver-candidates lists (`approver_repositories`); the server checks them again. It is created on the same POST /delegates as an
 * explicit grant, with kind `approver`; the server also checks that you are a code owner of every
 * repository named. These rows are listed and revoked here, not under Explicit grants.
 *
 * Like the delegates section, it belongs to the workspace it was rendered for (it is rendered keyed by
 * workspace id): an answer that settles after a switch is dropped.
 */
export function ApproversSection({
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
  /** A new value re-reads the list (a grant, binding or the trust rule changed elsewhere, which can end approvers). */
  refreshKey?: number;
  /** Called after an approver was added or removed, so what depends on the grants re-reads. */
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
    approvers: (await adminApi.delegateGrants(workspaceId, all, signal)).filter(isApprover),
    // When the list was read: a grant past its expiry by then shows expired (re-read on every change and refresh).
    readAt: Date.now(),
  }));
  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (seenRefresh !== refreshKey) {
    setSeenRefresh(refreshKey);
    reload();
  }
  const [agents, setAgents] = useState<ApproverCandidate[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsPartial, setAgentsPartial] = useState(false);
  // The repositories this opening of the form may offer: null while loading or when they couldn't be read.
  const [repoOptions, setRepoOptions] = useState<string[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // A plain disclosure (not an ARIA menu): Escape or a click outside closes it, and focus returns to its trigger.
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const menuPanel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (refocus: boolean) => {
      setMenuOpen(false);
      if (refocus) menuTrigger.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(true); };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuPanel.current?.contains(target) && !menuTrigger.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen]);
  // The candidates read answered 404: this install has no approver grants (relay-control can't confirm code owners).
  const [agentsUnavailable, setAgentsUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<{ area: Area; text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [loginsText, setLoginsText] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>(["land"]);
  // Null: no expiry chosen, so none is sent and the server's default applies.
  const [expiryDays, setExpiryDays] = useState<string | null>(null);

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

  // Each opening reads anew; only the latest read is applied, so an earlier one landing last is dropped.
  const agentsRequest = useRef(0);
  const loadAgents = async () => {
    const request = ++agentsRequest.current;
    try {
      const answer = await adminApi.approverCandidates(workspaceId);
      if (!mounted.current || request !== agentsRequest.current) return;
      setAgentsError(null);
      setAgentsPartial(answer.approver_candidates_partial === true);
      setRepoOptions(Array.isArray(answer.approver_repositories) ? answer.approver_repositories : null);
      setAgents(answer.approver_candidates.filter((agent) => Boolean(agent.address)));
    } catch (failure) {
      if (!mounted.current || request !== agentsRequest.current) return;
      setAgents(null);
      setAgentsPartial(false);
      setRepoOptions(null);
      if (failure instanceof ApiError && failure.status === 404) setAgentsUnavailable(true);
      else setAgentsError(delegationError(failure, "Could not list your agents."));
    }
  };

  const pinnable = (agents ?? []).filter((agent) => agent.address);
  const chosen = pinnable.find((agent) => agent.agent_id === agentId) ?? null;
  const logins = parseLogins(loginsText);
  const loginsProblem = loginsText.trim() && !logins
    ? "Enter GitHub logins separated by spaces or commas, at most 10 (an app login ends in [bot])."
    : null;
  // Only a repository this opening offered is ever sent.
  const scopes = approverScopes(repos.filter((repo) => repoOptions?.includes(repo)), kinds);
  const formValid = Boolean(chosen) && Boolean(logins?.length) && scopes.length > 0;
  const expiryChoices = approverExpiryOptions(maxExpiryDays);
  // With no expiry chosen none is sent, and the server sets min(30, the policy's maximum) days.
  const defaultDays = Math.min(30, maxExpiryDays, APPROVER_MAX_DAYS);

  const resetForm = () => {
    setAgentId("");
    setLoginsText("");
    setRepos([]);
    setKinds(["land"]);
    setExpiryDays(null);
  };

  // Read on every open: an agent connected (or an address changed) since the last open is offered at its current address.
  const openAdd = () => {
    setAdding(true);
    setFeedback(null);
    setAgentId("");
    setAgents(null);
    setAgentsError(null);
    setAgentsPartial(false);
    setAgentsUnavailable(false);
    setRepoOptions(null);
    setRepos([]);
    void loadAgents();
  };

  const addApprover = () =>
    run(async () => {
      if (!chosen?.address || !logins?.length || !scopes.length) {
        setError("add", "Pick an agent, its GitHub logins, a repository and what it may approve.");
        return;
      }
      const days = expiryDays ? Number(expiryDays) : null;
      if (days !== null && !expiryChoices.includes(days)) {
        setError("add", `Expiry must be one of ${expiryChoices.join(", ")} days.`);
        return;
      }
      await adminApi.createDelegateGrant(workspaceId, {
        delegate_agent_id: chosen.agent_id,
        kind: "approver",
        delegate_address: chosen.address,
        github_logins: logins,
        scopes,
        ...(days !== null ? { expires_at: new Date(Date.now() + days * 86_400_000 - 60_000).toISOString() } : {}),
      });
      if (!mounted.current) return;
      resetForm();
      setAdding(false);
      setNotice("table", `${chosen.name} is now an approver.`);
      return true;
    }, "Could not add the approver. Try again.", "add");

  const revoke = () => {
    const grantId = confirmId;
    setConfirmId(null);
    if (!grantId) return;
    return run(async () => {
      await adminApi.revokeDelegateGrant(workspaceId, grantId);
      if (mounted.current) setNotice("table", "Approver removed.");
      return true;
    }, "Could not remove the approver. Try again.", "table");
  };

  const toggle = (values: string[], value: string, on: boolean) =>
    on ? [...new Set([...values, value])] : values.filter((item) => item !== value);
  const id = (name: string) => `approvers-${name}-${workspaceId}`;
  // Only rows read for the view on screen; another view's rows (and their Remove buttons) never show.
  const approvers = list && list.all === all ? list.approvers : null;
  const message = (area: Area) =>
    feedback?.area === area ? (
      feedback.error ? (
        <p role="alert" className="text-sm text-destructive">{feedback.text}</p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{feedback.text}</p>
      )
    ) : null;
  // A grant past its expiry no longer counts, even before the server marks it expired.
  const live = (grant: DelegateGrant) => grant.status === "active" && Date.parse(grant.expires_at) > (list?.readAt ?? 0);
  const expiresText = (grant: DelegateGrant) =>
    live(grant) ? new Date(grant.expires_at).toLocaleDateString() : grant.status === "active" ? "expired" : grant.status;
  const targetsText = (grant: DelegateGrant) => grant.scopes.flatMap((scope) => scope.targets).join(" ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents that can approve releases for you</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {delegationEnabled && !adding ? (
            <Button type="button" size="sm" disabled={pending} onClick={openAdd}>Add approver</Button>
          ) : null}
          {isAdmin ? (
            <div className="relative">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="More approver actions"
                aria-expanded={menuOpen}
                aria-controls={id("more")}
                ref={menuTrigger}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </Button>
              {menuOpen ? (
                <div
                  id={id("more")}
                  ref={menuPanel}
                  className="absolute right-0 z-10 mt-1 min-w-44 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-1 shadow-md"
                >
                  <button
                    type="button"
                    aria-pressed={all}
                    id={id("all")}
                    disabled={pending}
                    className="w-full rounded border-0 bg-transparent px-2 py-1.5 text-left text-sm shadow-none hover:bg-[var(--surface-soft)]"
                    onClick={() => {
                      setMenuOpen(false);
                      menuTrigger.current?.focus();
                      setAll((value) => !value);
                      setConfirmId(null);
                      reload();
                    }}
                  >
                    {all ? "Show only mine" : "Show every approver"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {adding && delegationEnabled && agentsUnavailable ? (
          // relay-control has no approver-candidates route (404): no form, only why, and the list below still works.
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] p-3" role="group" aria-label="Add approver">
            <p className="text-sm text-muted-foreground">Approver grants aren&apos;t available on this install: it can&apos;t confirm code owners.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>Close</Button>
          </div>
        ) : adding && delegationEnabled ? (
          <form
            className="flex flex-col gap-3 rounded-lg border border-[var(--border-default)] p-3"
            aria-label="Add approver"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (formValid) void addApprover();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={id("agent")} className="text-sm font-medium">Agent</label>
                <select
                  id={id("agent")}
                  className={selectClass}
                  value={agentId}
                  disabled={pending || pinnable.length === 0}
                  onChange={(event) => setAgentId(event.target.value)}
                >
                  <option value="" disabled>Pick an agent</option>
                  {pinnable.map((agent) => (
                    <option key={agent.agent_id} value={agent.agent_id}>{`${agent.name} (${agent.address})`}</option>
                  ))}
                </select>
                {agents === null || agentsPartial || pinnable.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {agents === null
                      ? (agentsError ?? "Loading your agents...")
                      : agentsPartial
                        ? "Some agents couldn't be checked; try again by reopening the form."
                        : "None of your agents can be an approver yet. Connect one from Agent Relay Desktop or a hosted session."}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={id("logins")} className="text-sm font-medium">GitHub logins it acts as</label>
                <Input
                  id={id("logins")}
                  value={loginsText}
                  placeholder="login another-login[bot]"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={loginsProblem ? true : undefined}
                  aria-describedby={loginsProblem ? id("logins-hint") : undefined}
                  onChange={(event) => setLoginsText(event.target.value)}
                  disabled={pending}
                />
                {loginsProblem ? <p id={id("logins-hint")} role="alert" className="text-xs text-destructive">{loginsProblem}</p> : null}
              </div>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Repositories</legend>
              {agents === null ? null : repoOptions === null ? (
                <p className="text-xs text-muted-foreground">Connected repositories can&apos;t be read right now. Reopen the form to try again.</p>
              ) : repoOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No connected repository can have approvers yet.</p>
              ) : null}
              <div className="flex flex-wrap gap-4">
                {(repoOptions ?? []).map((repo) => (
                  <div key={repo} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={id(`repo-${repo}`)}
                      className="size-4"
                      checked={repos.includes(repo)}
                      disabled={pending}
                      onChange={(event) => setRepos((values) => toggle(values, repo, event.target.checked))}
                    />
                    <label htmlFor={id(`repo-${repo}`)} className="font-mono text-sm">{repo}</label>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">May approve</legend>
              <div className="flex flex-wrap gap-4">
                {APPROVER_KINDS.map((kind) => (
                  <div key={kind.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={id(`kind-${kind.value}`)}
                      className="size-4"
                      checked={kinds.includes(kind.value)}
                      disabled={pending}
                      onChange={(event) => setKinds((values) => toggle(values, kind.value, event.target.checked))}
                    />
                    <label htmlFor={id(`kind-${kind.value}`)} className="text-sm">{kind.label}</label>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {expiryDays === null ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  disabled={pending}
                  onClick={() => setExpiryDays(String(expiryChoices.at(-1)))}
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
                    {expiryChoices.map((days) => (
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
                <Button type="submit" size="sm" disabled={pending || !formValid}>Add approver</Button>
              </div>
            </div>
          </form>
        ) : null}

        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {delegationError(loadError, "Could not load approvers.")}{" "}
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={reload}>Try again</Button>
          </p>
        ) : null}
        {approvers === null ? (
          loadError ? null : <p className="text-sm text-muted-foreground">Loading...</p>
        ) : approvers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{all ? "No one in this workspace has an approver." : "No approvers."}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
            <table className={tableClass} aria-label="Approver grants">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Acts as</th>
                  <th>May approve</th>
                  <th>Expires</th>
                  <th><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {approvers.map((grant) => (
                  <tr key={grant.grant_id} className={live(grant) ? undefined : "text-muted-foreground"}>
                    <td>
                      <code className="font-mono">{grant.delegate_agent_id}</code>
                      {grant.delegate_address ? (
                        <span className="block font-mono text-xs text-muted-foreground">{grant.delegate_address}</span>
                      ) : null}
                      {all ? <span className="block text-xs text-muted-foreground">{`owner: ${grant.owner_id}`}</span> : null}
                    </td>
                    <td className="font-mono text-xs">{(grant.github_logins ?? []).join(" ")}</td>
                    <td className="font-mono text-xs">{targetsText(grant)}</td>
                    <td>{expiresText(grant)}</td>
                    <td className="text-right">
                      {live(grant) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          aria-label={`Remove approver ${grant.delegate_agent_id}`}
                          onClick={() => setConfirmId(grant.grant_id)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {confirmId ? (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] p-3" role="group" aria-label="Confirm approver removal">
            <p className="text-sm">Remove this approver? Its unredeemed approvals stop working at once.</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => void revoke()}>Remove</Button>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
        {message("table")}
        {!delegationEnabled ? (
          <p className="text-sm text-muted-foreground">Turn on delegation to add an approver.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
