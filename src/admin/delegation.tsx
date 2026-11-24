// Hosted Cloud's DelegationEnabledCard
// (packages/web/app/dashboard/settings/delegation-enabled-card.tsx), on
// relay-control's GET|PUT /workspaces/{id}/delegates/policy. Hosted reads the
// stored state on the server; here DelegationSection reads it with the GET and
// renders nothing until it has an answer, or at all when the read fails.
import { useEffect, useRef, useState } from "react";
import { adminApi, ApiError, SignedOut } from "./api";
import { message, useLoad } from "./use-load";
import { Button, Card, CardContent, CardHeader, CardTitle, Switch } from "../shell/ui";

/**
 * Reads the workspace's stored delegation switch and shows the card for it.
 * Render it keyed by workspace id: a workspace switch then starts a fresh
 * card, and a save still in flight for the old workspace is dropped.
 */
export function DelegationSection(props: { workspaceId: string; canManage: boolean }) {
  const { data, reload } = useLoad((signal) => adminApi.delegationPolicy(props.workspaceId, signal));
  // A failed first read hides the card rather than show a state relay-control
  // did not confirm. A failed re-read keeps the last confirmed state.
  if (!data) return null;
  return (
    <DelegationEnabledCard
      workspaceId={props.workspaceId}
      initialEnabled={data.delegation_enabled}
      canManage={props.canManage}
      onSaveFailed={reload}
    />
  );
}

function saveError(failure: unknown): string {
  if (failure instanceof ApiError) {
    // Delegation routes answer `{ error: <message>, code }`; others `{ error: <code>, message }`.
    const detail = (failure.body ?? {}) as { error?: unknown; message?: unknown };
    if (typeof detail.message === "string" && detail.message) return detail.message;
    if (typeof detail.error === "string" && detail.error) return detail.error;
    return "Could not change delegation. Try again.";
  }
  // An expired session goes to sign in; anything else never reached relay-control.
  if (failure instanceof SignedOut) return message(failure);
  return "Could not reach the server. Try again.";
}

/**
 * Turns owner-named trusted delegates on or off for this workspace. It sends
 * only `delegation_enabled`, so every other policy field keeps its stored
 * value. Only org owners and admins can change it; everyone else sees the
 * current state.
 */
export function DelegationEnabledCard({
  workspaceId,
  initialEnabled,
  canManage,
  onSaveFailed,
}: {
  workspaceId: string;
  initialEnabled: boolean;
  canManage: boolean;
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
  const [enabled, setEnabled] = useState(initialEnabled);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follow a new server value (a re-read after another admin changed it). A
  // value that arrives while a save is in flight may predate it, so it is
  // consumed without being applied: if the save succeeds its confirmed answer
  // stands; if it fails, that latest server value is applied (or the pre-save
  // state stays when none arrived). Later server values are followed.
  const latestServerValue = useRef(initialEnabled);
  useEffect(() => {
    latestServerValue.current = initialEnabled;
  }, [initialEnabled]);
  const [seen, setSeen] = useState(initialEnabled);
  if (seen !== initialEnabled) {
    setSeen(initialEnabled);
    if (!pending) {
      setEnabled(initialEnabled);
      setConfirming(false);
    }
  }

  const save = async (next: boolean) => {
    const serverValueAtStart = latestServerValue.current;
    // A failed save shows the latest server value if one arrived while it ran.
    const failed = (failure: unknown) => {
      if (latestServerValue.current !== serverValueAtStart) setEnabled(latestServerValue.current);
      setError(saveError(failure));
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
      setEnabled(policy.delegation_enabled);
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
