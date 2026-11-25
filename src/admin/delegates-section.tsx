// Hosted Cloud's DelegatesSection
// (packages/web/app/dashboard/settings/delegates-section.tsx), on
// relay-control's existing /workspaces/{id}/delegates routes: list grants
// (GET, `all=1` for owners and admins), grant (POST), revoke one
// (DELETE /{grantId}) or all (POST /revoke-all), and start a claim
// (POST /claims).
import { useEffect, useRef, useState } from "react";
import { adminApi } from "./api";
import { DELEGATION_CLASSES, type DelegationClass } from "./contracts";
import { delegationError } from "./delegation-errors";
import { useLoad } from "./use-load";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "../shell/ui";

type Claim = { claim_id: string; code: string; expires_at: string };
type Confirm = { kind: "one"; grantId: string } | { kind: "all" };

const fieldClass =
  "rounded-md border border-[var(--border-default)] bg-[var(--surface-soft)] px-3 py-1.5 text-sm text-foreground disabled:opacity-50";

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
 */
export function DelegatesSection({
  workspaceId,
  delegationEnabled,
  maxExpiryDays,
  isAdmin,
}: {
  workspaceId: string;
  delegationEnabled: boolean;
  maxExpiryDays: number;
  isAdmin: boolean;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [all, setAll] = useState(false);
  const { data: grants, error: loadError, reload } = useLoad((signal) =>
    adminApi.delegateGrants(workspaceId, all, signal),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [agentId, setAgentId] = useState("");
  const [actionClass, setActionClass] = useState<DelegationClass>(DELEGATION_CLASSES[0]);
  const [targets, setTargets] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [tierO, setTierO] = useState(false);

  /** Runs one change; `work` answers true when the grant list should be re-read. */
  const run = async (work: () => Promise<boolean | void>, fallback: string) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if ((await work()) && mounted.current) reload();
    } catch (failure) {
      if (mounted.current) setError(delegationError(failure, fallback));
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const startClaim = () =>
    run(async () => {
      const started = await adminApi.startDelegateClaim(workspaceId);
      if (mounted.current) setClaim(started);
    }, "Could not start a claim. Try again.");

  const addGrant = () =>
    run(async () => {
      const list = targets.split(/[\s,]+/u).map((target) => target.trim()).filter(Boolean);
      if (!agentId.trim() || !list.length) {
        setError("Enter the agent id and at least one target.");
        return;
      }
      const days = expiryDays.trim() ? Number(expiryDays) : null;
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > maxExpiryDays)) {
        setError(`Expiry must be a whole number of days from 1 to ${maxExpiryDays}.`);
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
      setTargets("");
      setExpiryDays("");
      setTierO(false);
      setNotice(`Granted ${granted.delegate_agent_id}.`);
      return true;
    }, "Could not grant the delegate. Try again.");

  const revoke = () => {
    const what = confirm;
    setConfirm(null);
    if (!what) return;
    return run(async () => {
      if (what.kind === "one") {
        await adminApi.revokeDelegateGrant(workspaceId, what.grantId);
        if (mounted.current) setNotice("Grant revoked.");
      } else {
        const revoked = await adminApi.revokeAllDelegateGrants(workspaceId, all);
        if (mounted.current) setNotice(`Revoked ${revoked.length} grant(s).`);
      }
      return true;
    }, "Could not revoke. Try again.");
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("Code copied.");
    } catch {
      setNotice("Copy failed; select the code and copy it by hand.");
    }
  };

  const id = (name: string) => `delegates-${name}-${workspaceId}`;
  const activeGrants = grants?.filter((grant) => grant.status === "active") ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delegates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          A delegate is one of your agents that may relay your approval to other people&apos;s agents, for the
          classes and targets you grant it.
        </p>

        {delegationEnabled ? (
          <section className="flex flex-col gap-2" aria-label="Claim an external agent">
            <p className="text-sm">
              An external agent (for example a chat assistant on another provider) becomes yours with a one-time
              code: start a claim, give it the code, and it completes the claim with its own agent token.
            </p>
            <div>
              <Button type="button" variant="outline" disabled={pending} onClick={() => void startClaim()}>
                Start a claim
              </Button>
            </div>
            {claim ? (
              <div className="flex flex-wrap items-center gap-2">
                <code data-testid="claim-code">{claim.code}</code>
                <Button type="button" variant="outline" onClick={() => void copy(claim.code)}>
                  Copy
                </Button>
                <span className="text-sm text-muted-foreground">
                  Valid until {new Date(claim.expires_at).toLocaleString()}; it works once.
                </span>
              </div>
            ) : null}
          </section>
        ) : null}

        {delegationEnabled ? (
          <form
            className="flex flex-col gap-2"
            aria-label="Grant a delegate"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void addGrant();
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={id("agent")} className="text-sm font-medium">Agent id</label>
                <Input id={id("agent")} value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={pending} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={id("class")} className="text-sm font-medium">Class</label>
                <select
                  id={id("class")}
                  className={fieldClass}
                  value={actionClass}
                  onChange={(event) => setActionClass(event.target.value as DelegationClass)}
                  disabled={pending}
                >
                  {DELEGATION_CLASSES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={id("targets")} className="text-sm font-medium">Targets</label>
                <Input
                  id={id("targets")}
                  value={targets}
                  placeholder="owner/repo, owner/*"
                  onChange={(event) => setTargets(event.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={id("expiry")} className="text-sm font-medium">
                  Expires in (days, up to {maxExpiryDays})
                </label>
                <Input
                  id={id("expiry")}
                  inputMode="numeric"
                  value={expiryDays}
                  onChange={(event) => setExpiryDays(event.target.value)}
                  disabled={pending}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={tierO} onChange={(event) => setTierO(event.target.checked)} disabled={pending} />
                Require my own approval (Tier O) for this class
              </label>
              <Button type="submit" disabled={pending}>Grant</Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Delegation is off for this workspace, so no claim or new grant can be made. Existing grants can still be
            listed and revoked.
          </p>
        )}

        <section className="flex flex-col gap-2" aria-label="Grants">
          <div className="flex flex-wrap items-center gap-3">
            {isAdmin ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(event) => {
                    setAll(event.target.checked);
                    setConfirm(null);
                    reload();
                  }}
                  disabled={pending}
                />
                Show every grant in the workspace
              </label>
            ) : null}
            {activeGrants.length ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirm({ kind: "all" })}>
                {all ? "Revoke every grant" : "Revoke all my grants"}
              </Button>
            ) : null}
          </div>
          {loadError && !grants ? (
            <p role="alert" className="text-sm text-destructive">
              {delegationError(loadError, "Could not load grants.")}{" "}
              <Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button>
            </p>
          ) : grants === null ? (
            <p className="text-sm text-muted-foreground">Loading grants...</p>
          ) : grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No grants yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Delegate grants">
              {grants.map((grant) => (
                <li key={grant.grant_id} className="flex flex-wrap items-center gap-2 text-sm">
                  <code>{grant.delegate_agent_id}</code>
                  <span>{grant.scopes.map((scope) => `${scope.class}: ${scope.targets.join(", ")}`).join("; ")}</span>
                  <span className="text-muted-foreground">
                    {`${grant.status}, expires ${new Date(grant.expires_at).toLocaleDateString()}`}
                  </span>
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
        </section>

        {confirm ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Confirm revocation">
            <p className="text-sm">
              {confirm.kind === "one"
                ? "Revoke this grant? Its unredeemed approvals stop working at once."
                : all
                  ? "Revoke every grant in this workspace? Every unredeemed approval under them stops working at once."
                  : "Revoke all your grants? Every unredeemed approval under them stops working at once."}
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={pending} onClick={() => void revoke()}>Revoke</Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {notice ? <p role="status" className="text-sm">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
