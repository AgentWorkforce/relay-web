import { useEffect, useRef, useState } from "react";
import { Plug, RefreshCw, Unplug } from "lucide-react";
import { Button, Badge, Skeleton } from "../shell/ui";
import { ProviderLogo } from "../shell/provider-logo";
import { adminApi } from "../admin/api";
import { message, useLoad } from "../admin/use-load";
import { WorkspaceViewSlot } from "../shell/view-slots";

type IntegrationListEntry = {
  provider: string;
  displayName: string;
  status: string;
  connectionId?: string;
  providerConfigKey: string | null;
  authMode?: "oauth2" | "api_key";
  accountLabel?: string | null;
  scopes?: string[];
  lastEventAt?: string | null;
  connectedAt?: string | null;
  name?: string;
  inherited?: boolean;
  upstreamConnected?: boolean | null;
};
import s from "./flow-connections.module.css";

export function connectionAuthLabel(
  entry: Pick<IntegrationListEntry, "authMode">,
) {
  return entry.authMode === "oauth2"
    ? "OAuth"
    : entry.authMode === "api_key"
      ? "Access token"
      : "Not recorded";
}
function label(entry: IntegrationListEntry) {
  return entry.displayName;
}

export function FlowConnectionsPage() {
  const { data, error, reload } = useLoad(async (signal) => {
    const context = await adminApi.context(signal);
    const catalog = await adminApi.integrationProviders(
      context.currentWorkspace.id,
      signal,
    );
    return {
      workspaceId: context.currentWorkspace.id,
      canManage: catalog.canManage ?? false,
    };
  });
  return (
    <>
      <WorkspaceViewSlot name="heading">
        <div className={s.header}>
          <h1>Connections</h1>
        </div>
      </WorkspaceViewSlot>
      {error ? (
        <div role="alert" className="p-6">
          {error.message}
          <Button variant="outline" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : data ? (
        <FlowConnections key={data.workspaceId} {...data} />
      ) : (
        <p className="p-6" role="status">
          Loading connections…
        </p>
      )}
    </>
  );
}

function state(entry: IntegrationListEntry): {
  label: string;
  variant: "success" | "warning" | "default";
} {
  if (entry.upstreamConnected === false)
    return { label: "Disconnected upstream", variant: "warning" };
  if (entry.status === "ready")
    return { label: "Connected", variant: "success" };
  if (["error", "degraded"].includes(entry.status))
    return { label: "Needs attention", variant: "warning" };
  if (entry.status === "syncing")
    return { label: "Syncing", variant: "default" };
  return { label: "Status unverified", variant: "default" };
}

/** Existing workspace integrations, including connections created by the CLI. */
export function FlowConnections(props: {
  workspaceId: string;
  canManage: boolean;
}) {
  return <ConnectionsView key={props.workspaceId} {...props} />;
}

function ConnectionsView({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [entries, setEntries] = useState<IntegrationListEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<IntegrationListEntry | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);

  async function load(signal?: AbortSignal) {
    const result = await adminApi.integrationProviders(workspaceId, signal);
    return result.providers.flatMap((provider) => {
      const c = provider.connection;
      return c
        ? [
            {
              provider: provider.id,
              displayName: provider.displayName,
              status: c.status,
              connectionId: c.connectionId,
              providerConfigKey: c.providerConfigKey ?? null,
              authMode: c.authMode,
              accountLabel: c.accountLabel,
              scopes: c.scopes,
              connectedAt: c.connectedAt,
              lastEventAt: c.lastRefreshedAt,
            },
          ]
        : [];
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    const mine = ++generation.current;
    void load(controller.signal).then(
      (result) => {
        if (generation.current === mine) setEntries(result);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Couldn’t load connections.",
          );
      },
    );
    return () => {
      controller.abort();
      generation.current = mine + 1;
    };
    // The workspace endpoint is the complete identity of this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    const mine = generation.current;
    setRefreshing(true);
    setError(null);
    setConfirm(null);
    try {
      const result = await load();
      if (mine === generation.current) setEntries(result);
    } catch (failure) {
      if (mine === generation.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t refresh connections.",
        );
    } finally {
      if (mine === generation.current) {
        busy.current = false;
        setRefreshing(false);
      }
    }
  }

  async function disconnect(entry: IntegrationListEntry) {
    if (!canManage || busy.current) return;
    busy.current = true;
    const mine = generation.current;
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.disconnectIntegration(workspaceId, entry.provider);
      if (mine !== generation.current) return;
      setEntries(
        (current) => current?.filter((item) => item !== entry) ?? null,
      );
      setConfirm(null);
      setNotice(
        `${label(entry)} disconnected. Flows using it will need a connection before they can run.`,
      );
    } catch (failure) {
      if (mine === generation.current) setError(message(failure));
    } finally {
      if (mine === generation.current) {
        busy.current = false;
        setDisconnecting(false);
      }
    }
  }

  return (
    <section className={s.connections} aria-label="Flow connections">
      <div className={s.header}>
        <div>
          <h2>Connections {entries && <span>{entries.length}</span>}</h2>
          <p>The tools your flows can use, wherever you connected them.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || disconnecting || (entries === null && !error)}
          onClick={() => void refresh()}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error && (
        <div role="alert">
          <strong>Couldn’t update connections</strong>
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      {!entries && !error && (
        <div aria-label="Loading connections" className={s.loading}>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {entries?.length === 0 && (
        <div className={s.empty}>
          <Plug aria-hidden="true" />
          <h3>No connections yet</h3>
          <p>
            Connect a tool when you create a flow, or use the CLI. It will
            appear here for you to inspect and manage.
          </p>
        </div>
      )}
      {entries && entries.length > 0 && (
        <ul className={s.list}>
          {entries.map((entry) => {
            const status = state(entry);
            const key = `${entry.provider}:${entry.name ?? ""}:${entry.connectionId}`;
            const selected = confirm === entry;
            return (
              <li key={key} className={s.row}>
                <details>
                  <summary className={s.summary}>
                    <span className={s.provider}>
                      <ProviderLogo provider={entry.provider} label={label(entry)} size={24} />
                      <span>
                        <strong>{label(entry)}</strong>
                        <small>
                          {entry.name ||
                            (entry.inherited
                              ? "Organization connection"
                              : "Workspace connection")}
                        </small>
                      </span>
                    </span>
                    <span className={s.method}>
                      {connectionAuthLabel(entry)}
                    </span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className={s.inspect}>Details</span>
                  </summary>
                  <div className={s.details}>
                    <dl>
                      <div>
                        <dt>Authentication</dt>
                        <dd>{connectionAuthLabel(entry)}</dd>
                      </div>
                      <div>
                        <dt>Provider configuration</dt>
                        <dd>{entry.providerConfigKey || "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Connection ID</dt>
                        <dd>{entry.connectionId || "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Last authenticated</dt>
                        <dd>
                          {entry.lastEventAt
                            ? new Date(entry.lastEventAt).toLocaleString()
                            : "No activity recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Account</dt>
                        <dd>{entry.accountLabel || "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Permissions</dt>
                        <dd>{entry.scopes?.join(", ") || "Not recorded"}</dd>
                      </div>
                    </dl>
                    {entry.inherited ? (
                      <p className={s.hint}>
                        Managed by your organization. Workspace disconnect is
                        unavailable.
                      </p>
                    ) : !canManage ? (
                      <p className={s.hint}>
                        Ask a workspace owner or admin to disconnect this tool.
                      </p>
                    ) : (
                      !selected &&
                      entry.connectionId && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disconnecting || refreshing}
                          onClick={() => {
                            setConfirm(entry);
                            setError(null);
                          }}
                        >
                          <Unplug data-icon="inline-start" aria-hidden="true" />
                          Disconnect
                        </Button>
                      )
                    )}
                  </div>
                </details>
                {selected && (
                  <div
                    className={s.confirm}
                    role="alertdialog"
                    aria-modal="false"
                    aria-label={`Disconnect ${label(entry)}?`}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !disconnecting)
                        setConfirm(null);
                    }}
                  >
                    <strong>Disconnect {label(entry)}?</strong>
                    <p>
                      Flows using this workspace connection may stop working.
                      You can connect it again when you need it.
                    </p>
                    <div className={s.actions}>
                      <Button
                        variant="outline"
                        size="sm"
                        autoFocus
                        disabled={disconnecting}
                        onClick={() => setConfirm(null)}
                      >
                        Keep connection
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={disconnecting}
                        onClick={() => void disconnect(entry)}
                      >
                        {disconnecting
                          ? "Disconnecting…"
                          : "Confirm disconnect"}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={s.hint}>
        Credentials stay private. New connections are added when a flow needs
        them.
      </p>
    </section>
  );
}
