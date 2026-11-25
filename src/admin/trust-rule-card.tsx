// Hosted Cloud's TrustRuleCard
// (packages/web/app/dashboard/settings/trust-rule-card.tsx), on
// relay-control's GET|PUT|DELETE /workspaces/{id}/delegates/trust-rule.
// Like Cloud, it offers no per-class owner tap: the rule needs no tap for any
// class (#owner-decisions 251241083284656128), so turning it on sends `{}`.
import { useEffect, useRef, useState } from "react";
import { adminApi, ApiError } from "./api";
import type { TrustRuleCovered, TrustRuleState } from "./contracts";
import { delegationError } from "./delegation-errors";
import { useLoad } from "./use-load";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../shell/ui";

const CONNECTOR_LABELS: Record<string, string> = { "grok-bot": "Grok", chatgpt: "ChatGPT", muse: "Muse", mcp: "MCP connector" };

/** How an agent reached the rule: the connector it was proven through, or a claim. */
export function rootLabel(item: Pick<TrustRuleCovered, "root_kind" | "connector">): string {
  if (item.root_kind === "claim") return "claimed bot";
  if (item.root_kind === "connector") {
    return `connector ${item.connector ? (CONNECTOR_LABELS[item.connector] ?? item.connector) : "unknown"}`;
  }
  return "connected assistant";
}

/**
 * The caller's own set-once trust rule, shown under Trusted delegates whenever
 * the policy could be read. Turning it on asks once and needs delegation on;
 * revoking is one click and works with delegation off too, as the API allows. It lists
 * every agent the rule covers now, with the connector or claim it was proven
 * through, so the owner can find what to disconnect.
 *
 * It belongs to the workspace it was rendered for (DelegationSection is keyed
 * by workspace id): an answer that settles after a switch is dropped. A
 * relay-control without the trust-rule route (404 on the read) hides it.
 *
 * A successful turn-on or revoke is applied at once from its answer, then
 * re-read; a read issued before the write never replaces it (even if the
 * re-read fails, which shows its error with a retry).
 */
export function TrustRuleCard({
  workspaceId,
  delegationEnabled,
}: {
  workspaceId: string;
  /** With delegation off, a rule can only be revoked, not turned on; it covers nothing until delegation is on again. */
  delegationEnabled: boolean;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Reads are numbered when issued, so a write's confirmed state outranks every read issued before it.
  const reads = useRef(0);
  const { data, error: loadError, reload } = useLoad(async (signal) => {
    const read = ++reads.current;
    return { state: await adminApi.trustRule(workspaceId, signal), read };
  });
  const [confirmed, setConfirmed] = useState<{ state: TrustRuleState; through: number } | null>(null);
  const state = confirmed && (!data || data.read <= confirmed.through) ? confirmed.state : (data?.state ?? null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loadError instanceof ApiError && loadError.status === 404 && !state) return null;

  /** Runs one write; `work` answers the state it confirmed, applied before the re-read. */
  const write = async (work: () => Promise<TrustRuleState>, fallback: string) => {
    setPending(true);
    setError(null);
    try {
      const next = await work();
      if (!mounted.current) return;
      setConfirmed({ state: next, through: reads.current });
      reload();
    } catch (failure) {
      if (mounted.current) setError(delegationError(failure, fallback));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirming(false);
      }
    }
  };
  const turnOn = () =>
    write(async () => {
      const { rule } = await adminApi.putTrustRule(workspaceId);
      // A new rule covers no agent until one relays an approval; the re-read fills in the lists.
      return { rule, covered: [], shadowed: [] };
    }, "Could not turn on the trust rule. Try again.");
  const revoke = () =>
    write(async () => {
      try {
        await adminApi.revokeTrustRule(workspaceId);
      } catch (failure) {
        // A revoke that finds no rule (another tab revoked it) still leaves the rule off.
        if (!(failure instanceof ApiError && failure.status === 404)) throw failure;
      }
      return { rule: null, covered: [], shadowed: [] };
    }, "Could not revoke the trust rule. Try again.");

  const rule = state?.rule ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trust rule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Trust every assistant you connect, and every agent they start, for every action class this workspace allows.
          It has no expiry and needs no tap from you. It lasts until you revoke it here or disconnect the assistant.
        </p>
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {delegationError(loadError, "Could not load your trust rule.")}{" "}
            <Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button>
          </p>
        ) : null}
        {!state && !loadError ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {state && !rule && !delegationEnabled ? (
          <p className="text-sm text-muted-foreground">Turn on Trusted delegates to use the trust rule.</p>
        ) : null}
        {state && !rule && !confirming && delegationEnabled ? (
          <div>
            <Button type="button" disabled={pending} onClick={() => setConfirming(true)}>
              Trust my connected assistants
            </Button>
          </div>
        ) : null}
        {state && !rule && confirming && delegationEnabled ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Confirm turning on the trust rule">
            <p className="text-sm">
              Every connected assistant, every class, no expiry, no tap, until you revoke it or the connector. A
              bot&apos;s own grant still wins over this rule.
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={pending} onClick={() => void turnOn()}>
                {pending ? "Turning on..." : "Turn on the trust rule"}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {rule ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              On since {new Date(rule.created_at).toLocaleString()}. Revoking ends the rule and every grant it created,
              and cancels their unused approvals.
            </p>
            {!delegationEnabled ? (
              <p className="text-sm text-muted-foreground">
                Trusted delegates is off, so the rule covers nothing until it is turned back on. You can still revoke it.
              </p>
            ) : null}
            <div>
              <Button type="button" variant="destructive" disabled={pending} onClick={() => void revoke()}>
                {pending ? "Revoking..." : "Revoke trust rule"}
              </Button>
            </div>
            {state!.covered.length ? (
              <ul className="flex flex-col gap-1 text-sm" aria-label="Agents the trust rule covers">
                {state!.covered.map((item) => (
                  <li key={item.grant_id}>
                    <span className="font-mono">{item.delegate_agent_id}</span>
                    {" · "}
                    {item.hops
                      ? `started by ${item.launched_by ?? "an agent"} under ${rootLabel(item)} ${item.root_agent_id ?? ""}`.trim()
                      : rootLabel(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No agent has used it yet. An assistant appears here the first time it relays your approval.
              </p>
            )}
            {state!.shadowed.length ? (
              <p className="text-sm text-muted-foreground">
                {state!.shadowed.length === 1
                  ? "1 bot uses its own grant"
                  : `${state!.shadowed.length} bots use their own grants`}{" "}
                instead of this rule. Revoke a bot&apos;s grant under Delegates to put it under the rule.
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
