// Hosted Cloud's DelegationEnabledCard
// (packages/web/app/dashboard/settings/delegation-enabled-card.tsx), on
// relay-control's GET|PUT /workspaces/{id}/delegates/policy. Hosted reads the
// stored state on the server; here DelegationSection reads it with the GET and
// renders nothing until it has an answer, or at all when the read fails.
// Under the card sits the Delegates section (delegates-section.tsx).
import { useEffect, useRef, useState } from "react";
import { adminApi } from "./api";
import type { DelegationPolicy } from "./contracts";
import { delegationError } from "./delegation-errors";
import { useLoad } from "./use-load";
import { Button, Card, CardContent, CardHeader, CardTitle, Switch } from "../shell/ui";
import { DelegatesSection } from "./delegates-section";
import { TrustRuleCard } from "./trust-rule-card";

/**
 * Reads the workspace's stored delegation policy and shows the switch for it,
 * the caller's trust rule, then the Delegates section, which follows the policy (claims and new grants
 * need delegation on; grants cannot outlive its maximum). Render it keyed by
 * workspace id: a workspace switch then starts fresh, and a request still in
 * flight for the old workspace is dropped.
 */
export function DelegationSection(props: { workspaceId: string; canManage: boolean }) {
  // Each read is a new observation, numbered when it is issued, even when its
  // value equals the previous read's: the card compares reads, not booleans.
  const reads = useRef(0);
  const { data, reload } = useLoad(async (signal) => {
    const read = ++reads.current;
    return { policy: await adminApi.delegationPolicy(props.workspaceId, signal), read };
  });
  // The policy a successful save confirmed, and the last read issued before
  // it. It stands over any read issued no later than that (even one that
  // completes after the save, or when the re-read fails); a read issued after
  // the save replaces it.
  const [saved, setSaved] = useState<{ policy: DelegationPolicy; through: number } | null>(null);
  // A failed first read hides the card rather than show a state relay-control
  // did not confirm. A failed re-read keeps the last confirmed state.
  if (!data) return null;
  const policy = saved && data.read <= saved.through ? saved.policy : data.policy;
  return (
    <>
      <DelegationEnabledCard
        workspaceId={props.workspaceId}
        serverEnabled={policy.delegation_enabled}
        readId={data.read}
        canManage={props.canManage}
        // Apply the confirmed policy at once (the Delegates section follows it
        // even if the re-read fails), then re-read. A failed save re-reads so
        // it shows the server's value.
        onSaved={(confirmed) => {
          setSaved({ policy: confirmed, through: reads.current });
          reload();
        }}
        onSaveFailed={reload}
      />
      {/* Shown with delegation off too: a rule stays revocable while delegation is off. */}
      <TrustRuleCard workspaceId={props.workspaceId} delegationEnabled={data.policy.delegation_enabled} />
      <DelegatesSection
        workspaceId={props.workspaceId}
        delegationEnabled={policy.delegation_enabled}
        maxExpiryDays={policy.max_expiry_days}
        isAdmin={props.canManage}
      />
    </>
  );
}

/**
 * Turns owner-named trusted delegates on or off for this workspace. It sends
 * only `delegation_enabled`, so every other policy field keeps its stored
 * value. Only org owners and admins can change it; everyone else sees the
 * current state.
 */
export function DelegationEnabledCard({
  workspaceId,
  serverEnabled,
  readId,
  canManage,
  onSaved,
  onSaveFailed,
}: {
  workspaceId: string;
  /** The value of the latest completed read. */
  serverEnabled: boolean;
  /** Identifies that read: a new id is a fresh read, whatever its value. */
  readId: number;
  canManage: boolean;
  /** Gets the policy the save confirmed; the parent applies it, then re-reads. */
  onSaved?: (policy: DelegationPolicy) => void;
  /** Asks for a fresh read, so a failed save shows the server's latest value. */
  onSaveFailed?: () => void;
}) {
  // A save that settles after the card unmounted (a workspace switch remounts
  // it under a new key) is about another workspace: it is ignored.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [enabled, setEnabled] = useState(serverEnabled);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follow every fresh read (a re-read after a failed save, or after another
  // admin changed it), tracked by read id rather than by value: a fresh read
  // whose value equals an older read is still applied. A read that completes
  // while a save is in flight may predate it, so it is consumed without being
  // applied: if the save succeeds its confirmed answer stands; if it fails,
  // that latest read is applied (or the pre-save state stays when none
  // arrived). Later reads are followed.
  const latestRead = useRef({ id: readId, enabled: serverEnabled });
  useEffect(() => {
    latestRead.current = { id: readId, enabled: serverEnabled };
  }, [readId, serverEnabled]);
  const [seenRead, setSeenRead] = useState(readId);
  if (seenRead !== readId) {
    setSeenRead(readId);
    // A fresh read that changes the state closes an open prompt (it asked
    // about the old state); one that confirms it, such as the re-read after a
    // save, leaves the prompt alone.
    if (!pending && serverEnabled !== enabled) {
      setEnabled(serverEnabled);
      setConfirming(false);
    }
  }

  const save = async (next: boolean) => {
    const readAtStart = latestRead.current.id;
    // A failed save shows the latest read if one completed while it ran.
    const failed = (failure: unknown) => {
      if (latestRead.current.id !== readAtStart) setEnabled(latestRead.current.enabled);
      setError(delegationError(failure, "Could not change delegation. Try again."));
      onSaveFailed?.();
    };
    // Every settled save (success, API error, network failure, or an answer
    // dropped after a workspace switch) closes the prompt and re-enables the
    // switch, so neither can stay stuck.
    setPending(true);
    setError(null);
    try {
      const policy = await adminApi.setDelegationEnabled(workspaceId, next);
      if (!mounted.current) return;
      // The saved value is now the baseline; only a later read replaces it.
      latestRead.current = { ...latestRead.current, enabled: policy.delegation_enabled };
      setEnabled(policy.delegation_enabled);
      onSaved?.(policy);
    } catch (failure) {
      if (!mounted.current) return;
      failed(failure);
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  const switchId = `delegation-enabled-${workspaceId}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trusted delegates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          When this is on, people in this workspace can name an agent that relays their approval to other
          people&apos;s agents, within the grants they set. Turning it off refuses every delegated approval at
          once; grants are kept and work again when it is turned back on.
        </p>
        <div className="flex items-center gap-3">
          <Switch
            id={switchId}
            checked={enabled}
            disabled={!canManage || pending || confirming}
            onCheckedChange={(value) => {
              if (value) setConfirming(true);
              else void save(false);
            }}
          />
          <label htmlFor={switchId} className="text-sm leading-none font-medium select-none">
            {enabled ? "Delegation is on" : "Delegation is off"}
          </label>
        </div>
        {confirming ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Confirm turning on delegation">
            <p className="text-sm">
              Turn on delegation for this workspace? Delegated approvals then count for anyone whose grant
              covers them.
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={pending} onClick={() => void save(true)}>
                {pending ? "Turning on..." : "Turn on delegation"}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {!canManage ? <p className="text-sm text-muted-foreground">Only org owners and admins can change this.</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
