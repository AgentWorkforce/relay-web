// Operator-only hard delete of one session. relaycontrol enforces the role;
// hiding the control from members is only presentation.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { adminApi, canManage, SignedOut } from "../admin/api";
import { Button } from "../shell/ui";

export function DeleteSession({
  workspaceId,
  source,
  sessionId,
  onDeleted,
  onSignedOut,
}: {
  workspaceId: string;
  source: string;
  sessionId: string;
  onDeleted: () => void;
  onSignedOut?: () => void;
}) {
  const [organization, setOrganization] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    adminApi.context(abort.signal).then(
      (context) => {
        if (canManage(context.currentOrganization.role)) {
          setOrganization(context.currentOrganization.id);
        }
      },
      () => undefined,
    );
    return () => abort.abort();
  }, []);

  if (!organization) return null;

  async function erase(id: string) {
    setBusy(true);
    setError(null);
    try {
      const { status, unreadable } = await adminApi.hardDeleteSession(id, { workspaceId, source, sessionId });
      if (status === "completed") {
        onDeleted();
        return;
      }
      // "Hidden" and "erased" are different states; only completed means erased.
      setStarted(
        unreadable
          ? "This session is now hidden from everyone. Stored data is still being erased, which can take up to 48 hours."
          : "Deletion is in progress.",
      );
    } catch (failure) {
      if (failure instanceof SignedOut) {
        onSignedOut?.();
        return;
      }
      setError(failure instanceof Error ? failure.message : "The session could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (started) {
    return <p role="status" className="max-w-sm text-xs text-muted-foreground">{started}</p>;
  }
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden="true" />
        Delete session
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label="Confirm delete session" className="flex max-w-sm flex-col gap-2 text-xs">
      <p>
        Permanently delete this session and everything derived from it for your whole
        organization? This can&apos;t be undone. The person who ran it stays a member.
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void erase(organization)}>
          Yes, delete session
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
