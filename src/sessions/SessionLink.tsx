// A session link with only an id (Agent Relay Desktop's "View on web"): find
// the session's source in this workspace, then replace the URL with the full
// session link so reload and back behave like any other session.
import { useEffect, useState } from "react";
import { SignedOut } from "../api/client";
import { Button } from "../shell/ui";
import { findSessionSources, type SessionMatch } from "./api";
import { harnessName } from "./data";
import { onLinkClick, sessionHref } from "./route";
import { SessionsPage, SessionsSkeleton } from "./SessionsPage";

type Lookup =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "choose"; matches: SessionMatch[] }
  | { status: "failed"; error: Error };

export function SessionLink({
  workspaceId,
  sessionId,
  event,
  from,
  routeWorkspaceId,
  onSignedOut,
}: {
  workspaceId: string;
  sessionId: string;
  event: string | null;
  from: string | null;
  /** The workspace named in the link, kept on the resolved URL. */
  routeWorkspaceId?: string;
  onSignedOut: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<Lookup>({ status: "loading" });
  const href = (source: string) =>
    sessionHref(sessionId, source, event, from, routeWorkspaceId);

  useEffect(() => {
    const request = new AbortController();
    findSessionSources(workspaceId, sessionId, request.signal).then(
      (matches) => {
        if (request.signal.aborted) return;
        if (matches.length === 1) {
          window.history.replaceState(null, "", sessionHref(sessionId, matches[0]!.source, event, from, routeWorkspaceId));
          window.dispatchEvent(new PopStateEvent("popstate"));
          return;
        }
        setLookup(matches.length ? { status: "choose", matches } : { status: "missing" });
      },
      (error: unknown) => {
        if (request.signal.aborted) return;
        if (error instanceof SignedOut) onSignedOut();
        setLookup({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => request.abort();
  }, [workspaceId, sessionId, event, from, routeWorkspaceId, attempt, onSignedOut]);

  if (lookup.status === "loading") return <SessionsSkeleton label="Opening session…" />;
  if (lookup.status === "failed")
    return (
      <div role="alert" className="load-error">
        <span>
          {lookup.error instanceof SignedOut
            ? "Taking you to sign in…"
            : `Couldn’t open this session. ${lookup.error.message}`}
        </span>
        {!(lookup.error instanceof SignedOut) && (
          <Button variant="outline" size="sm" onClick={() => {
              setLookup({ status: "loading" });
              setAttempt((value) => value + 1);
            }}>
            Retry
          </Button>
        )}
      </div>
    );
  if (lookup.status === "choose")
    return (
      <div role="status" className="flex flex-col gap-2 p-6 text-sm">
        <p>This session was recorded by more than one harness. Choose one to open:</p>
        <ul className="flex flex-col gap-1">
          {lookup.matches.map((match) => (
            <li key={match.source}>
              <a className="underline" href={href(match.source)} onClick={onLinkClick}>
                {harnessName(match.source)}
                {harnessName(match.source) !== match.source ? ` (${match.source})` : ""}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <>
      <p role="status" className="load-error">
        Session {sessionId} wasn’t found in this workspace. It may not have synced yet, or it belongs to another workspace.
      </p>
      <SessionsPage key="sessions" workspaceId={workspaceId} initialQuery="" tab="sessions" onSignedOut={onSignedOut} />
    </>
  );
}
