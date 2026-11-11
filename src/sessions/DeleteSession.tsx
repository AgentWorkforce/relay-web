// Operator-only hard delete of one session. relaycontrol enforces the role;
// hiding the control from members is only presentation.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { adminApi, canManage, SignedOut } from "../admin/api";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../shell/ui";

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
  const mounted = useRef(true);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const descriptionId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    // Closing/reopening the dialog must not start a second request while the
    // first is unresolved, including clicks before React commits disabled.
    if (inFlight.current || started) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { status, unreadable } = await adminApi.hardDeleteSession(id, {
        workspaceId,
        source,
        sessionId,
      });
      if (status === "completed") {
        // Never navigate someone who has already moved on to another page.
        if (mounted.current) {
          setConfirming(false);
          onDeleted();
        }
        return;
      }
      if (status === "failed") {
        setError("The session could not be fully erased. Please try again.");
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
      setError(
        failure instanceof Error
          ? failure.message
          : "The session could not be deleted.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (started && !confirming) {
    return (
      <p role="status" className="max-w-sm text-xs text-muted-foreground">
        {started}
      </p>
    );
  }
  function close() {
    setConfirming(false);
    setError(null);
  }

  return (
    <>
      <Button
        ref={deleteButton}
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
        Delete session
      </Button>
      {confirming && (
        <DeleteConfirmation
          onClose={close}
          opener={deleteButton}
          busy={busy}
          descriptionId={descriptionId}
        >
          <CardDescription id={descriptionId}>
            Permanently delete this session and everything derived from it for
            your whole organization? This can&apos;t be undone. The person who
            ran it stays a member.
          </CardDescription>
          <div className="mt-4 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !!started}
              onClick={() => void erase(organization)}
            >
              Yes, delete session
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-cancel-delete
              onClick={close}
            >
              Cancel
            </Button>
          </div>
          {busy && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Deletion is in progress.
            </p>
          )}
          {started && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {started}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </DeleteConfirmation>
      )}
    </>
  );
}

// Match InviteMemberDialog's portal, background isolation and focus behavior.
// There is no shared Dialog primitive in the self-hosted shell.
function DeleteConfirmation({
  onClose,
  opener,
  busy,
  descriptionId,
  children,
}: {
  onClose: () => void;
  opener: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  descriptionId: string;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const panel = dialog.current!;
    const trigger = opener.current;
    const cancel = panel.querySelector<HTMLButtonElement>(
      "[data-cancel-delete]",
    )!;
    const background = [...document.body.children]
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay.current,
      )
      .map((element) => ({
        element,
        hidden: element.getAttribute("aria-hidden"),
        inert: element.hasAttribute("inert"),
      }));
    for (const { element } of background) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }
    cancel.focus();
    function onFocus(event: FocusEvent) {
      if (!panel.contains(event.target as Node)) cancel.focus();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [
        ...panel.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      ];
      const first = buttons[0]!;
      const last = buttons[buttons.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      for (const { element, hidden, inert } of background) {
        if (hidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", hidden);
        if (!inert) element.removeAttribute("inert");
      }
      if (trigger?.isConnected) trigger.focus();
    };
  }, [opener]);
  return createPortal(
    <div
      ref={overlay}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        className="relative max-h-full w-full max-w-lg overflow-y-auto"
      >
        <Card>
          <CardHeader className="bg-[var(--surface-strong)]">
            <CardTitle id={titleId}>Confirm delete session</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">{children}</CardContent>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
