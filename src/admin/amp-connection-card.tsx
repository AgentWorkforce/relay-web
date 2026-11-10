"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "../shell/ui";
import type { ComponentProps } from "react";
import type { AmpAction, AmpActionResult, AmpView } from "./amp-types";
const Label = (props: ComponentProps<"label">) => <label {...props} />;
export function AmpConnectionCard({
  workspaceId,
  initial,
  canManage,
  action,
  mcpUrl,
}: {
  workspaceId: string;
  initial: AmpView;
  canManage: boolean;
  mcpUrl: string;
  action(workspaceId: string, input: AmpAction): Promise<AmpActionResult>;
}) {
  const [view, setView] = useState(initial),
    [key, setKey] = useState(""),
    [threadId, setThreadId] = useState("");
  const [threads, setThreads] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestVersion = useRef(0);
  useEffect(() => {
    const version = requestVersion;
    version.current++;
    return () => {
      version.current++;
    };
  }, [initial]);
  const [snapshot, setSnapshot] = useState(initial);
  if (initial !== snapshot) {
    setSnapshot(initial);
    if (
      JSON.stringify(initial.connection) !== JSON.stringify(view.connection)
    ) {
      setThreads([]);
      setThreadId("");
      setKey("");
    }
    setView(initial);
  }
  const run = (input: AmpAction) => {
    const version = ++requestVersion.current;
    startTransition(async () => {
      setError(null);
      setKey("");
      try {
        const result = await action(workspaceId, input);
        if (version !== requestVersion.current) return;
        if (!result.ok) return setError(result.error);
        if (
          JSON.stringify(result.connection) !== JSON.stringify(view.connection)
        ) {
          setThreads([]);
          setThreadId("");
        }
        setView(result);
        setKey("");
        if (result.threads) setThreads(result.threads);
      } catch {
        if (version !== requestVersion.current) return;
        setError("Amp could not complete this operation. Please try again.");
      }
    });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Amp</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Connect Amp to receive Relay messages in selected orb threads. Only
          connect threads you want to share with this workspace.
        </p>
        {!view.history?.available && (
          <p role="note">
            Amp history sync is not available on this installation yet.
            Connecting a thread enables Relay messaging, not transcript uploads.
          </p>
        )}
        {view.connection ? (
          <div className="flex flex-wrap gap-3 items-center">
            <span>
              Connected with <code>{view.connection.keyHint}</code>
            </span>
            <Button
              variant="outline"
              disabled={!canManage || pending}
              onClick={() => run({ kind: "disconnect" })}
            >
              Disconnect
            </Button>
            <Button
              variant="outline"
              disabled={!canManage || pending}
              onClick={() => run({ kind: "discover" })}
            >
              Choose threads
            </Button>
          </div>
        ) : null}
        {canManage ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              run({ kind: "connect", key });
            }}
          >
            <div className="flex min-w-72 flex-col gap-1.5">
              <Label htmlFor={`amp-key-${workspaceId}`}>
                {view.connection ? "Replace Amp API key" : "Amp API key"}
              </Label>
              <Input
                id={`amp-key-${workspaceId}`}
                type="password"
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
                placeholder="sgamp_…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending || !key.trim()}>
              {pending ? "Working…" : "Connect"}
            </Button>
            <a
              className="text-sm underline"
              href="https://ampcode.com/settings/security"
              target="_blank"
              rel="noreferrer"
            >
              Get an Amp API key
            </a>
          </form>
        ) : (
          <p>Ask an organization owner or admin to connect Amp.</p>
        )}
        {view.connection && canManage ? (
          <>
            {threads.length ? (
              <ul>
                {threads.map((thread) => (
                  <li className="flex gap-3 items-center" key={thread.id}>
                    <span>{thread.title}</span>
                    <Button
                      variant="outline"
                      disabled={
                        pending ||
                        view.bindings.some((b) => b.threadId === thread.id)
                      }
                      onClick={() => run({ kind: "bind", threadId: thread.id })}
                    >
                      Connect thread
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="flex gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                run({ kind: "bind", threadId });
              }}
            >
              <Input
                aria-label="Amp thread URL or ID"
                placeholder="Or paste an Amp thread link"
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
              />
              <Button type="submit" disabled={pending || !threadId.trim()}>
                Connect thread
              </Button>
            </form>
          </>
        ) : null}
        {view.bindings.length ? (
          <ul>
            {view.bindings.map((binding) => (
              <li className="flex flex-col gap-1" key={binding.id}>
                <span>
                  <code>{binding.threadId}</code> as{" "}
                  <code>@{binding.agentName}</code> · {binding.state}
                </span>
                {binding.deliveries.map((delivery) => (
                  <div key={delivery.messageId} className="text-sm">
                    <span>
                      {delivery.state === "unknown" ||
                      delivery.state === "sending"
                        ? "Delivery needs inspection"
                        : "Delivery queued for retry"}
                      : <code>{delivery.messageId}</code>
                    </span>
                    {["unknown", "sending"].includes(delivery.state) ? (
                      <Button
                        variant="outline"
                        disabled={!canManage || pending}
                        onClick={() =>
                          run({
                            kind: "check_delivery",
                            id: binding.id,
                            messageId: delivery.messageId,
                          })
                        }
                      >
                        Check delivery
                      </Button>
                    ) : null}
                  </div>
                ))}
                {binding.lastError ? (
                  <span role="alert">{binding.lastError}</span>
                ) : null}
                <Button
                  variant="outline"
                  disabled={!canManage || pending}
                  onClick={() => run({ kind: "unbind", id: binding.id })}
                >
                  Disconnect thread
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {view.connection ? (
          <div className="text-sm text-muted-foreground">
            <p>
              For Relay tools inside Amp, add a personal remote MCP server in
              Amp’s Integrations &amp; MCP settings with OAuth, then sign in to
              this workspace:
            </p>
            <code className="break-all">{mcpUrl}</code>
            <p>
              When replying, use send_relay_message with as set to this thread’s
              Relay agent name. History availability is shown above; connecting
              does not enable uploads.
            </p>
          </div>
        ) : null}
        {pending ? <p role="status">Connecting to Amp…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
