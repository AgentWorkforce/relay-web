// Hosted Cloud's TrustRuleCard
// (packages/web/app/dashboard/settings/trust-rule-card.tsx), on
// relay-control's GET|PUT|DELETE /workspaces/{id}/delegates/trust-rule.
// Self-host also lets the owner pick the classes that still need their own
// tap (`require_tier_o`), which the route accepts on every PUT.
import { useEffect, useRef, useState } from "react";
import { adminApi, ApiError } from "./api";
import { DELEGATION_CLASSES, type DelegationClass, type TrustRuleCovered } from "./contracts";
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

const sameClasses = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

/**
 * The caller's own set-once trust rule. Shown under Trusted delegates while
 * delegation is on. Turning it on asks once; revoking is one click. It lists
 * every agent the rule covers now, with the connector or claim it was proven
 * through, so the owner can find what to disconnect.
 *
 * It belongs to the workspace it was rendered for (DelegationSection is keyed
 * by workspace id): an answer that settles after a switch is dropped. A
 * relay-control without the trust-rule route (404 on the read) hides it.
 */
export function TrustRuleCard({ workspaceId }: { workspaceId: string }) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { data: state, error: loadError, reload } = useLoad((signal) => adminApi.trustRule(workspaceId, signal));
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The classes that still need the owner's tap: a draft, seeded from the rule.
  const [tierO, setTierO] = useState<DelegationClass[]>([]);
  const stored = state?.rule?.require_tier_o ?? [];
  const storedKey = state ? `${state.rule?.trust_rule_id ?? "off"}:${stored.join(",")}` : null;
  const [seeded, setSeeded] = useState<string | null>(null);
  if (storedKey !== null && storedKey !== seeded) {
    setSeeded(storedKey);
    setTierO(DELEGATION_CLASSES.filter((item) => stored.includes(item)));
  }

  if (loadError instanceof ApiError && loadError.status === 404 && !state) return null;

  const write = async (work: () => Promise<unknown>, fallback: string) => {
    setPending(true);
    setError(null);
    try {
      await work();
      if (mounted.current) reload();
    } catch (failure) {
      if (mounted.current) setError(delegationError(failure, fallback));
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirming(false);
      }
    }
  };
  const turnOn = () => write(() => adminApi.putTrustRule(workspaceId, tierO), "Could not turn on the trust rule. Try again.");
  const saveTierO = () => write(() => adminApi.putTrustRule(workspaceId, tierO), "Could not save. Try again.");
  const revoke = () =>
    write(async () => {
      try {
        await adminApi.revokeTrustRule(workspaceId);
      } catch (failure) {
        // A revoke that finds no rule (another tab revoked it) still leaves the rule off.
        if (!(failure instanceof ApiError && failure.status === 404)) throw failure;
      }
    }, "Could not revoke the trust rule. Try again.");

  const tierOBoxes = (
    <fieldset className="flex flex-col gap-1" disabled={pending}>
      <legend className="text-sm font-medium">Still ask me first (Tier O) for</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {DELEGATION_CLASSES.map((item) => (
          <label key={item} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tierO.includes(item)}
              onChange={(event) =>
                setTierO((current) =>
                  event.target.checked
                    ? DELEGATION_CLASSES.filter((each) => each === item || current.includes(each))
                    : current.filter((each) => each !== item),
                )
              }
            />
            {item}
          </label>
        ))}
      </div>
    </fieldset>
  );

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
        {loadError && !state ? (
          <p role="alert" className="text-sm text-destructive">
            {delegationError(loadError, "Could not load your trust rule.")}{" "}
            <Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button>
          </p>
        ) : null}
        {!state && !loadError ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {state && !rule && !confirming ? (
          <div>
            <Button type="button" disabled={pending} onClick={() => setConfirming(true)}>
              Trust my connected assistants
            </Button>
          </div>
        ) : null}
        {state && !rule && confirming ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Confirm turning on the trust rule">
            <p className="text-sm">
              Every connected assistant, every class, no expiry, no tap, until you revoke it or the connector. A
              bot&apos;s own grant still wins over this rule.
            </p>
            {tierOBoxes}
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
            <div>
              <Button type="button" variant="destructive" disabled={pending} onClick={() => void revoke()}>
                {pending ? "Revoking..." : "Revoke trust rule"}
              </Button>
            </div>
            {tierOBoxes}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || sameClasses(tierO, stored)}
                onClick={() => void saveTierO()}
              >
                Save
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
